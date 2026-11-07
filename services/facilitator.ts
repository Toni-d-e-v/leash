// Leash facilitator: x402 v2 /supported, /verify, /settle for the `leash` scheme.
// Public facilitators reject Leash payments (the transfer is a CPI from our program,
// see docs/x402.md), so we verify the policy `spend` ourselves.
import { Router } from "express";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { connection } from "../shared/config.js";
import { PROGRAM_ID, coder, decodeLeashError, parseSpendEvents, type SpendEventData } from "../shared/leash.js";
import {
  LEASH_SCHEME, X402_VERSION, caip2, type PaymentPayload, type PaymentRequirements,
  type SettlementResponse, type VerifyResponse,
} from "../shared/x402.js";

const conn = connection();
const usedNonces = new Set<string>(); // request_ids already settled (or in flight)
let network: string;

interface Checked { tx: VersionedTransaction; policy: string; agent: string }

const invalid = (invalidReason: string, invalidMessage?: string, payer = ""): VerifyResponse =>
  ({ isValid: false, invalidReason, invalidMessage, payer });

/** Static checks on the transaction: it must contain exactly one matching Leash `spend`. */
function inspect(p: PaymentPayload, req: PaymentRequirements): Checked | VerifyResponse {
  if (p.x402Version !== X402_VERSION) return invalid("invalid_x402_version");
  if (req.scheme !== LEASH_SCHEME || p.accepted?.scheme !== LEASH_SCHEME) return invalid("unsupported_scheme");
  if (req.network !== network) return invalid("invalid_network");
  const nonce = req.extra?.nonce;
  if (!nonce || p.accepted.extra?.nonce !== nonce) return invalid("invalid_payment_requirements", "nonce mismatch");
  if ((req.extra?.expiresAt ?? 0) < Date.now() / 1000) return invalid("invalid_payment_requirements", "payment request expired");
  if (usedNonces.has(nonce)) return invalid("invalid_transaction_state", "nonce already used (replay)");

  let tx: VersionedTransaction;
  try { tx = VersionedTransaction.deserialize(Buffer.from(p.payload.transaction, "base64")); }
  catch { return invalid("invalid_payload", "transaction does not deserialize"); }
  const msg = tx.message;
  if (msg.addressTableLookups.length > 0) return invalid("invalid_payload", "address lookup tables not supported");
  const keys = msg.staticAccountKeys;

  const spends = msg.compiledInstructions.filter((i) => keys[i.programIdIndex].equals(PROGRAM_ID));
  const decoded = spends.map((i) => ({ i, d: coder.instruction.decode(Buffer.from(i.data)) })).filter((x) => x.d?.name === "spend");
  if (decoded.length !== 1) return invalid("invalid_payload", `expected exactly one Leash spend, found ${decoded.length}`);
  const { i, d } = decoded[0];
  const acc = i.accountKeyIndexes.map((k) => keys[k]);
  const [agent, policy, mint, , recipientToken, tokenProgram] = acc;
  const args = d!.data as any;

  if (mint.toBase58() !== req.asset) return invalid("invalid_payload", "wrong mint");
  const expectedAta = getAssociatedTokenAddressSync(new PublicKey(req.asset), new PublicKey(req.payTo), true, tokenProgram);
  if (!recipientToken.equals(expectedAta)) return invalid("invalid_payload", "recipient is not payTo");
  if (BigInt(args.amount.toString()) < BigInt(req.amount)) return invalid("insufficient_funds", "amount below price");
  if (Buffer.from(args.request_id ?? args.requestId).toString("hex") !== nonce) return invalid("invalid_payload", "request_id != nonce");
  return { tx, policy: policy.toBase58(), agent: agent.toBase58() };
}

function eventMatches(ev: SpendEventData | undefined, req: PaymentRequirements) {
  return !!ev && ev.recipient === req.payTo && ev.amount >= BigInt(req.amount) && ev.requestId === req.extra?.nonce;
}

export async function verify(p: PaymentPayload, req: PaymentRequirements): Promise<VerifyResponse> {
  const c = inspect(p, req);
  if (!("tx" in c)) return c;
  const sim = await conn.simulateTransaction(c.tx, { sigVerify: true, commitment: "confirmed" });
  if (sim.value.err) {
    const name = decodeLeashError(sim.value.logs ?? []) ?? JSON.stringify(sim.value.err);
    return invalid("invalid_transaction_state", `Leash policy rejected payment: ${name}`, c.policy);
  }
  const [ev] = parseSpendEvents(sim.value.logs ?? []);
  if (!eventMatches(ev, req)) return invalid("invalid_payload", "simulated SpendEvent does not match requirements", c.policy);
  return { isValid: true, payer: c.policy };
}

export async function settle(p: PaymentPayload, req: PaymentRequirements): Promise<SettlementResponse> {
  const fail = (errorReason: string, errorMessage?: string, payer = "", transaction = ""): SettlementResponse =>
    ({ success: false, errorReason, errorMessage, payer, transaction, network });
  const v = await verify(p, req);
  if (!v.isValid) return fail(v.invalidReason!, v.invalidMessage, v.payer);
  const nonce = req.extra!.nonce;
  if (usedNonces.has(nonce)) return fail("invalid_transaction_state", "nonce already used (replay)", v.payer);
  usedNonces.add(nonce); // reserve before sending so concurrent retries can't double-settle

  const tx = VersionedTransaction.deserialize(Buffer.from(p.payload.transaction, "base64"));
  let sig = "";
  try {
    sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    const bh = tx.message.recentBlockhash;
    const { lastValidBlockHeight } = await conn.getLatestBlockhash();
    const conf = await conn.confirmTransaction({ signature: sig, blockhash: bh, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) throw new Error(JSON.stringify(conf.value.err));
    const onchain = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!onchain || onchain.meta?.err) throw new Error("transaction failed onchain");
    const [ev] = parseSpendEvents(onchain.meta?.logMessages ?? []);
    if (!eventMatches(ev, req)) throw new Error("onchain SpendEvent does not match requirements");
    return { success: true, payer: v.payer, transaction: sig, network, amount: ev.amount.toString() };
  } catch (e: any) {
    if (!sig) usedNonces.delete(nonce); // never broadcast: allow a retry
    return fail("unexpected_settle_error", decodeLeashError(e) ?? e.message, v.payer, sig);
  }
}

export async function facilitatorRouter(): Promise<Router> {
  network = await caip2(conn);
  const r = Router();
  r.get("/supported", (_req, res) => {
    res.json({
      kinds: [{ x402Version: X402_VERSION, scheme: LEASH_SCHEME, network, extra: { programId: PROGRAM_ID.toBase58() } }],
      extensions: [],
      signers: {},
    });
  });
  r.post("/verify", async (req, res) => {
    try { res.json(await verify(req.body.paymentPayload, req.body.paymentRequirements)); }
    catch (e: any) { res.json(invalid("unexpected_verify_error", e.message)); }
  });
  r.post("/settle", async (req, res) => {
    try { res.json(await settle(req.body.paymentPayload, req.body.paymentRequirements)); }
    catch (e: any) { res.json({ success: false, errorReason: "unexpected_settle_error", errorMessage: e.message, transaction: "", network }); }
  });
  return r;
}

export const getNetwork = () => network;
