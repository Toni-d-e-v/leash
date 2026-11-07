// Kill switch from the CLI: `npm run pause` / `npm run unpause`.
import { currentPolicy, program, sendOwner } from "./lib/policy.js";
import { loadKeypair, explorerTx, EVENTS_URL } from "../shared/config.js";
import { ix } from "../shared/leash.js";

const paused = process.argv[2] !== "off";
const { policy } = currentPolicy();
const owner = loadKeypair("owner");
const sig = await sendOwner([await ix.setPaused(program, owner.publicKey, policy, paused)], owner);
console.log(`${paused ? "PAUSED" : "Unpaused"} policy ${policy.toBase58()}\n  ${explorerTx(sig)}`);
await fetch(`${EVENTS_URL}/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "owner", action: paused ? "paused" : "unpaused", signature: sig }),
}).catch(() => {});
