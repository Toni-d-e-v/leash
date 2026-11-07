// Agent-side Leash payments: build/sign `spend` transactions and run the x402 402 → pay → retry loop.
// Only ever uses the agent session key.
import {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getProgram, ix, sha256, decodeLeashError, parseSpendEvents } from "./leash.js";
import {
  HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, X402_VERSION, b64json, unb64json,
  type PaymentPayload, type PaymentRequired, type PaymentRequirements, type SettlementResponse,
} from "./x402.js";

export interface SpendRequest {
  policy: PublicKey;
  mint: PublicKey;
  recipient: PublicKey;
  amount: bigint;
  requestId: Buffer; // 32 bytes
  reason: string;
}

export async function buildSpendTx(conn: Connection, agent: Keypair, r: SpendRequest): Promise<VersionedTransaction> {
  const program = getProgram(conn);
  const recipientAta = getAssociatedTokenAddressSync(r.mint, r.recipient, true);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: agent.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
      // Make sure the recipient token account exists (no-op if it does).
      createAssociatedTokenAccountIdempotentInstruction(agent.publicKey, recipientAta, r.recipient, r.mint),
      await ix.spend(program, {
        agent: agent.publicKey, policy: r.policy, mint: r.mint, recipient: r.recipient, amount: r.amount,
        requestId: r.requestId, reasonHash: sha256(r.reason),
      }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([agent]);
  return tx;
}

export type SpendResult =
  | { ok: true; signature: string; spentInWindow: bigint }
  | { ok: false; error: string; signature?: string; logs?: string[] };

/** Submit a spend directly (used by the `pay` tool). Simulates first so rejections carry the Anchor error name. */
export async function sendSpend(conn: Connection, agent: Keypair, r: SpendRequest): Promise<SpendResult> {
  const tx = await buildSpendTx(conn, agent, r);
  const sim = await conn.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) {
    return { ok: false, error: decodeLeashError(sim.value.logs ?? []) ?? JSON.stringify(sim.value.err), logs: sim.value.logs ?? [] };
  }
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await conn.confirmTransaction(sig, "confirmed");
    const onchain = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (conf.value.err || onchain?.meta?.err) {
      return { ok: false, signature: sig, error: decodeLeashError(onchain?.meta?.logMessages ?? []) ?? "TransactionFailed" };
    }
    const [ev] = parseSpendEvents(onchain?.meta?.logMessages ?? []);
    return { ok: true, signature: sig, spentInWindow: ev?.spentInWindow ?? 0n };
  } catch (e) {
    return { ok: false, error: decodeLeashError(e) ?? String((e as Error).message ?? e) };
  }
}

/**
 * Submit a rejected spend anyway (skipPreflight) so the failure lands onchain with a signature
 * that can be opened in the explorer. Fee only; no funds move.
 */
export async function sendSpendForReceipt(conn: Connection, agent: Keypair, r: SpendRequest): Promise<string | undefined> {
  try {
    const tx = await buildSpendTx(conn, agent, r);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  } catch {
    return undefined;
  }
}

export type CallResult =
  | { kind: "ok"; status: number; body: any; settlement?: SettlementResponse }
  | { kind: "payment_required"; required: PaymentRequired; requirements: PaymentRequirements; body: any }
  | { kind: "error"; status: number; body: any; settlement?: SettlementResponse };

/** One HTTP call. Pass `payment` to retry with a PAYMENT-SIGNATURE header. */
export async function httpCall(url: string, method: "GET" | "POST", body?: unknown, payment?: PaymentPayload): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (payment) headers[HEADER_SIGNATURE] = b64json(payment);
  const res = await fetch(url, { method, headers, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  const json = await res.json().catch(() => ({}));
  const settleHeader = res.headers.get(HEADER_RESPONSE);
  const settlement = settleHeader ? unb64json<SettlementResponse>(settleHeader) : undefined;
  if (res.status === 402 && !payment) {
    const h = res.headers.get(HEADER_REQUIRED);
    const required = h ? unb64json<PaymentRequired>(h) : (json as PaymentRequired);
    return { kind: "payment_required", required, requirements: required.accepts[0], body: json };
  }
  if (res.ok) return { kind: "ok", status: res.status, body: json, settlement };
  return { kind: "error", status: res.status, body: json, settlement };
}

export function paymentPayload(required: PaymentRequired, requirements: PaymentRequirements, tx: VersionedTransaction): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    resource: required.resource,
    accepted: requirements,
    payload: { transaction: Buffer.from(tx.serialize()).toString("base64") },
  };
}
