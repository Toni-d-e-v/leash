// Owner changes the limits from the CLI (the dashboard's "Edit limits" does the same):
//   npm run set-limits -- --per-tx 0.10 --daily 0.50 --approval 0.08
// Values are in USDC; omitted ones keep their current value. --approval 0 turns approvals off.
// The expiry is left as it is. Both instructions go in one transaction.
import { parseArgs } from "node:util";
import { currentPolicy, program, sendOwner } from "./lib/policy.js";
import { loadKeypair, explorerTx, EVENTS_URL, toBase, fromBase } from "../shared/config.js";
import { ix, decodeLeashError } from "../shared/leash.js";

const { values } = parseArgs({ options: { "per-tx": { type: "string" }, daily: { type: "string" }, approval: { type: "string" } } });
const usdc = (name: string, v: string | undefined, current: bigint) => {
  if (v === undefined) return current;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative USDC amount`);
  return toBase(n);
};

const { policy } = currentPolicy();
const owner = loadKeypair("owner");
const p = await program.account.policy.fetch(policy);
const perTxCap = usdc("per-tx", values["per-tx"], BigInt(p.perTxCap.toString()));
const dailyCap = usdc("daily", values.daily, BigInt(p.dailyCap.toString()));
const approval = usdc("approval", values.approval, BigInt(p.approvalThreshold.toString()));

let sig: string;
try {
  sig = await sendOwner([
    await ix.updateLimits(program, owner.publicKey, policy, { perTxCap, dailyCap, expiresAt: BigInt(p.expiresAt.toString()) }),
    await ix.setApprovalThreshold(program, owner.publicKey, policy, approval),
  ], owner);
} catch (e: any) {
  console.error(`Rejected by the program: ${decodeLeashError(e.logs ?? []) ?? e.message}`);
  process.exit(1);
}

const f = (b: bigint) => fromBase(b).toFixed(2);
const summary = `${f(perTxCap)}/tx · ${f(dailyCap)}/day · approval ${approval === 0n ? "off" : `above ${f(approval)}`}`;
console.log(`Limits updated: ${summary}\n  ${explorerTx(sig)}`);
await fetch(`${EVENTS_URL}/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "owner", action: "limits", detail: summary, signature: sig }),
}).catch(() => {});
