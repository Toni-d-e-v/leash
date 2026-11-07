// One paid market-data call with the agent key; prints {ok, error} as JSON. Used by the E2E checks.
// Optional argv[2]: the reason to record.
import { callService } from "../../agent/tools.js";
const r: any = await callService({ name: "market-data", reason: process.argv[2] ?? "Kill-switch check: fetch SOL market data." });
console.log(JSON.stringify({ ok: r.ok, error: r.error }));
