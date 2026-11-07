// One paid market-data call with the agent key; prints {ok, error} as JSON. Used by check-killswitch.
import { callService } from "../../agent/tools.js";
const r: any = await callService({ name: "market-data", reason: "Kill-switch check: fetch SOL market data." });
console.log(JSON.stringify({ ok: r.ok, error: r.error }));
