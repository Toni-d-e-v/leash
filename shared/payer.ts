// Agent-side Leash payments: build/sign `spend` transactions and run the x402 402 → pay → retry loop.
// Only ever uses the agent session key.
import {
  ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getProgram, ix, sha256, decodeLeashError, parseSpendEvents, pendingPda } from "./leash.js";
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

/** Ask the owner to approve a payment above the threshold: creates the PendingSpend PDA. */
export async function sendRequestSpend(conn: Connection, agent: Keypair, r: SpendRequest): Promise<SpendResult & { pending?: string }> {
  const program = getProgram(conn);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: agent.publicKey,
    recentBlockhash: blockhash,
    instructions: [await ix.requestSpend(program, {
      agent: agent.publicKey, policy: r.policy, mint: r.mint, recipient: r.recipient, amount: r.amount,
      requestId: r.requestId, reasonHash: sha256(r.reason),
    })],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([agent]);
  const sim = await conn.simulateTransaction(tx, { sigVerify: true });
  if (sim.value.err) return { ok: false, error: decodeLeashError(sim.value.logs ?? []) ?? JSON.stringify(sim.value.err) };
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(sig, "confirmed");
  return { ok: true, signature: sig, spentInWindow: 0n, pending: pendingPda(r.policy, r.requestId).toBase58() };
}

/**
 * Wait until the owner approves or rejects a pending payment (the PendingSpend account closes).
 * Approved ⇔ the closing transaction emitted a SpendEvent with our request_id.
 */
export async function waitForResolution(
  conn: Connection, pending: string, requestId: Buffer, timeoutMs = 100_000,
): Promise<{ status: "approved"; signature: string } | { status: "rejected"; signature?: string } | { status: "timeout" }> {
  const pk = new PublicKey(pending);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const acc = await conn.getAccountInfo(pk, "confirmed");
    if (!acc) {
      const sigs = await conn.getSignaturesForAddress(pk, { limit: 5 }, "confirmed");
      for (const s of sigs) {
        const tx = await conn.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        if (tx?.meta?.err) continue;
        const ev = parseSpendEvents(tx?.meta?.logMessages ?? []).find((e) => e.requestId === requestId.toString("hex"));
        if (ev) return { status: "approved", signature: s.signature };
        if (tx?.meta?.logMessages?.some((l) => l.includes("Instruction: RejectSpend"))) return { status: "rejected", signature: s.signature };
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { status: "timeout" };
}
