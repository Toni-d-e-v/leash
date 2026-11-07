// x402 smoke test: 402 → pay (Leash spend) → retry → 200 for market-data, then prove a replay is rejected.
import { connection, loadKeypair, readDemoConfig, SERVICES_URL, explorerTx, pk } from "../shared/config.js";
import { buildSpendTx, httpCall, paymentPayload } from "../shared/payer.js";

const conn = connection();
const cfg = readDemoConfig();
if (!cfg.policy) throw new Error("No policy: run npm run reset-demo");
const agent = loadKeypair("agent");
const url = `${SERVICES_URL}/api/market-data`;
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };

console.log(`1) GET ${url} (no payment)`);
const first = await httpCall(url, "GET");
if (first.kind !== "payment_required") fail(`expected 402, got ${first.kind}`);
const { required, requirements } = first as Extract<typeof first, { kind: "payment_required" }>;
console.log(`   → 402 PAYMENT-REQUIRED: scheme=${requirements.scheme} network=${requirements.network}`);
console.log(`     amount=${requirements.amount} asset=${requirements.asset.slice(0, 8)}… payTo=${requirements.payTo.slice(0, 8)}… nonce=${requirements.extra!.nonce.slice(0, 16)}…`);

console.log(`2) Build Leash spend (request_id = nonce), signed by the agent key`);
const tx = await buildSpendTx(conn, agent, {
  policy: pk(cfg.policy.address), mint: pk(cfg.mint), recipient: pk(requirements.payTo),
  amount: BigInt(requirements.amount), requestId: Buffer.from(requirements.extra!.nonce, "hex"),
  reason: "Smoke test: buy one SOL market snapshot.",
});
const payment = paymentPayload(required, requirements, tx);

console.log(`3) Retry with PAYMENT-SIGNATURE`);
const second = await httpCall(url, "GET", undefined, payment);
if (second.kind !== "ok") fail(`expected 200, got ${JSON.stringify(second)}`);
const ok = second as Extract<typeof second, { kind: "ok" }>;
console.log(`   → ${ok.status} PAYMENT-RESPONSE: success=${ok.settlement?.success} tx=${ok.settlement?.transaction}`);
console.log(`     SOL $${ok.body.data.price.usd} (${ok.body.data.price.change24hPct}% 24h)`);
console.log(`     ${explorerTx(ok.settlement!.transaction)}`);

console.log(`4) Replay the same PAYMENT-SIGNATURE to the API`);
const replay = await httpCall(url, "GET", undefined, payment);
if (replay.kind === "ok") fail("replay was accepted");
const rb = (replay as any).body ?? {};
console.log(`   → rejected: HTTP ${(replay as any).status} error="${rb.error}"${rb.message ? ` (${rb.message})` : ""}`);

console.log(`5) Replay the same payload straight to the facilitator /settle`);
const direct = await (await fetch(`${SERVICES_URL}/facilitator/settle`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: requirements }),
})).json();
if (direct.success) fail("facilitator settled a replay");
console.log(`   → success=${direct.success} errorReason=${direct.errorReason} (${direct.errorMessage})`);
console.log("PASS");
