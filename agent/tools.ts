// The agent's four tools. They hold only the agent session key; the owner key is never loaded here.
import { PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import {
  connection, loadKeypair, readDemoConfig, explorerTx, fromBase, toBase, pk, SERVICES_URL, EVENTS_URL,
} from "../shared/config.js";
import { getProgram, sha256, decodeLeashError } from "../shared/leash.js";
import { buildSpendTx, httpCall, paymentPayload, sendSpend, sendSpendForReceipt } from "../shared/payer.js";

const conn = connection();
const program = getProgram(conn);
const cfg = readDemoConfig();
if (!cfg.policy) throw new Error("No demo policy. Run `npm run reset-demo`.");
const POLICY = pk(cfg.policy.address);
const MINT = pk(cfg.mint);
export const agentKey = loadKeypair("agent");

/** Post an activity event to the dashboard feed (best effort; the agent keeps working if it's down). */
export async function emit(ev: Record<string, unknown>) {
  try {
    await fetch(`${EVENTS_URL}/events`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ policy: POLICY.toBase58(), ...ev }),
    });
  } catch { /* feed offline */ }
}

const serviceByRecipient = (addr: string) => cfg.services.find((s) => s.recipient === addr)?.name;

export async function listServices() {
  const res = await fetch(`${SERVICES_URL}/api/services`);
  const list = (await res.json()) as any[];
  return list.map((s) => ({ name: s.name, method: s.method, price_usdc: s.price, description: s.description }));
}

export async function checkBudget() {
  const p = await program.account.policy.fetch(POLICY);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = p.windowStart.toNumber();
  const rolled = now - windowStart >= 86_400;
  const spent = rolled ? 0n : BigInt(p.spentInWindow.toString());
  const daily = BigInt(p.dailyCap.toString());
  const vault = await getAccount(conn, new PublicKey(cfg.policy!.vault)).then((a) => a.amount).catch(() => 0n);
  const expiresAt = p.expiresAt.toNumber();
  return {
    paused: p.paused,
    expired: expiresAt !== 0 && now >= expiresAt,
    per_tx_cap_usdc: fromBase(BigInt(p.perTxCap.toString())),
    daily_cap_usdc: fromBase(daily),
    spent_today_usdc: fromBase(spent),
    remaining_today_usdc: fromBase(daily - spent),
    vault_balance_usdc: fromBase(vault),
    window_resets_in_s: rolled ? 86_400 : windowStart + 86_400 - now,
    expires_in_s: expiresAt === 0 ? null : Math.max(0, expiresAt - now),
  };
}

export interface PayArgs { recipient: string; amount_usdc: number; reason: string; request_id?: string; service?: string }

/** Direct payment through the Leash policy. Rejections come back as the Anchor error name. */
export async function pay(a: PayArgs) {
  let recipient: PublicKey;
  try { recipient = new PublicKey(a.recipient); } catch { return { ok: false, error: "InvalidRecipientAddress" }; }
  const amount = toBase(a.amount_usdc);
  const requestId = a.request_id ? Buffer.from(a.request_id, "hex") : randomBytes(32);
  const req = { policy: POLICY, mint: MINT, recipient, amount, requestId, reason: a.reason };
  const service = a.service ?? serviceByRecipient(a.recipient) ?? "unknown recipient";
  const res = await sendSpend(conn, agentKey, req);
  if (res.ok) {
    await emit({
      type: "spend", service, recipient: a.recipient, amount: amount.toString(), reason: a.reason,
      reasonHash: sha256(a.reason).toString("hex"), requestId: requestId.toString("hex"),
      signature: res.signature, explorer: explorerTx(res.signature), spentInWindow: res.spentInWindow.toString(),
    });
    return { ok: true, signature: res.signature, explorer: explorerTx(res.signature) };
  }
  return reject(res.error, req, service, a);
}

async function reject(error: string, req: Parameters<typeof sendSpend>[2], service: string, a: PayArgs) {
  // Land the rejected tx onchain so the failure has a signature to open in the explorer.
  const receipt = await sendSpendForReceipt(conn, agentKey, req);
  await emit({
    type: "rejection", error, service, recipient: a.recipient, amount: req.amount.toString(), reason: a.reason,
    attempted: `pay ${a.amount_usdc} USDC to ${service === "unknown recipient" ? a.recipient : service}`,
    signature: receipt, explorer: receipt ? explorerTx(receipt) : undefined,
  });
  return {
    ok: false,
    error: `Payment rejected by policy: ${error}`,
    explorer: receipt ? explorerTx(receipt) : undefined,
  };
}

export interface CallArgs { name: string; params?: Record<string, unknown>; reason: string }

/** Call a paid API: 402 → Leash spend (request_id = nonce) → retry with PAYMENT-SIGNATURE. */
export async function callService(a: CallArgs) {
  const svc = cfg.services.find((s) => s.name === a.name);
  if (!svc) return { ok: false, error: `Unknown service ${a.name}` };
  const method = a.name === "summarize" ? "POST" : "GET";
  const url = `${SERVICES_URL}${svc.path}`;

  const first = await httpCall(url, method, a.params);
  if (first.kind === "ok") return { ok: true, data: first.body.data };
  if (first.kind !== "payment_required") return { ok: false, error: `HTTP ${first.status}`, body: first.body };

  const r = first.requirements;
  const req = {
    policy: POLICY, mint: MINT, recipient: pk(r.payTo), amount: BigInt(r.amount),
    requestId: Buffer.from(r.extra!.nonce, "hex"), reason: a.reason,
  };
  const preview = first.body?.preview;
  const tx = await buildSpendTx(conn, agentKey, req);

  // Check the policy locally first: a rejected spend never reaches the API.
  const sim = await conn.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) {
    const error = decodeLeashError(sim.value.logs ?? []) ?? JSON.stringify(sim.value.err);
    const out = await reject(error, req, a.name, { recipient: r.payTo, amount_usdc: fromBase(BigInt(r.amount)), reason: a.reason, service: a.name });
    return preview ? { ...out, preview_returned_by_service: preview } : out;
  }

  const second = await httpCall(url, method, a.params, paymentPayload(first.required, r, tx));
  if (second.kind !== "ok") {
    return { ok: false, error: `Service did not accept payment: ${second.kind === "error" ? JSON.stringify(second.body) : "402"}` };
  }
  const sig = second.settlement!.transaction;
  await emit({
    type: "spend", service: a.name, recipient: r.payTo, amount: r.amount, reason: a.reason,
    reasonHash: sha256(a.reason).toString("hex"), requestId: r.extra!.nonce,
    signature: sig, explorer: explorerTx(sig),
  });
  return { ok: true, paid_usdc: fromBase(BigInt(r.amount)), explorer: explorerTx(sig), data: second.body.data };
}
