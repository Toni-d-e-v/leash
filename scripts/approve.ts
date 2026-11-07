// Owner approves or rejects a pending payment: `npm run approve -- <pending> [--reject]`
// Without an address it resolves the most recent pending request of the demo policy.
import { PublicKey } from "@solana/web3.js";
import { currentPolicy, program, sendOwner, conn } from "./lib/policy.js";
import { loadKeypair, explorerTx, EVENTS_URL, pk } from "../shared/config.js";
import { ix } from "../shared/leash.js";

const reject = process.argv.includes("--reject");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const { cfg, policy } = currentPolicy();
const owner = loadKeypair("owner");

let pending: PublicKey;
if (arg) pending = new PublicKey(arg);
else {
  const all = await program.account.pendingSpend.all([{ memcmp: { offset: 8, bytes: policy.toBase58() } }]);
  if (all.length === 0) { console.log("No pending approvals."); process.exit(0); }
  pending = all.sort((x, y) => y.account.createdAt.toNumber() - x.account.createdAt.toNumber())[0].publicKey;
}
const p = await program.account.pendingSpend.fetch(pending);
const sig = await sendOwner([await ix.resolveSpend(program, !reject, {
  owner: owner.publicKey, policy, mint: pk(cfg.mint), pending, requester: p.requester, recipientToken: p.recipientToken,
})], owner);
console.log(`${reject ? "Rejected" : "Approved"} ${Number(p.amount) / 1e6} USDC (pending ${pending.toBase58()})\n  ${explorerTx(sig)}`);
await fetch(`${EVENTS_URL}/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "owner", action: reject ? "rejected" : "approved", signature: sig, pending: pending.toBase58() }),
}).catch(() => {});
void conn;
