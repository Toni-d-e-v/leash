// Phase 3 spike: can a public x402 facilitator verify a Leash payment?
// Builds a Leash `spend` (the payment is a CPI TransferChecked from the policy vault),
// shaped per the SVM "exact" scheme (v0 tx, compute budget ixs, facilitator as fee payer,
// partially signed by the agent), and POSTs it to the facilitator's /verify.
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, TransactionMessage, VersionedTransaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import { getProgram, ix, policyPda, sha256 } from "../shared/leash.js";

const FACILITATOR = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"; // devnet (CAIP-2)
const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const devnet = new Connection("https://api.devnet.solana.com", "confirmed");

async function main() {
  const supported = await (await fetch(`${FACILITATOR}/supported`)).json();
  const kind = supported.kinds.find((k: any) => k.x402Version === 2 && k.scheme === "exact" && k.network === NETWORK);
  if (!kind) throw new Error(`facilitator does not support exact on ${NETWORK}`);
  const feePayer = new PublicKey(kind.extra.feePayer);

  // Ephemeral keys: nothing here touches real funds.
  const agent = Keypair.generate();
  const owner = Keypair.generate();
  const payTo = Keypair.generate().publicKey;
  const policy = policyPda(owner.publicKey, 1n);
  const nonce = randomBytes(32);
  const amount = 50_000n; // 0.05 USDC

  const spend: TransactionInstruction = await ix.spend(getProgram(devnet), {
    agent: agent.publicKey, policy, mint: DEVNET_USDC, recipient: payTo, amount,
    requestId: nonce, reasonHash: sha256("x402 spike"),
  });
  const { blockhash } = await devnet.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      spend,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([agent]); // partial: fee payer signature left empty for the facilitator

  const requirements = {
    scheme: "exact", network: NETWORK, amount: amount.toString(), asset: DEVNET_USDC.toBase58(),
    payTo: payTo.toBase58(), maxTimeoutSeconds: 120, extra: { feePayer: feePayer.toBase58() },
  };
  const body = {
    x402Version: 2,
    paymentPayload: {
      x402Version: 2,
      resource: { url: "http://localhost:4020/api/market-data", description: "Leash spike" },
      accepted: requirements,
      payload: { transaction: Buffer.from(tx.serialize()).toString("base64") },
    },
    paymentRequirements: requirements,
  };
  const res = await fetch(`${FACILITATOR}/verify`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  console.log(`POST ${FACILITATOR}/verify → HTTP ${res.status}`);
  console.log(await res.text());
}

main().catch((e) => { console.error(e); process.exit(1); });
