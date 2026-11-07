// Close the previous demo policy (if any) and create a fresh one with a new policy_id.
import { closeCurrentPolicy, createDemoPolicy } from "./lib/policy.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, EVENTS_URL } from "../shared/config.js";

async function main() {
  await closeCurrentPolicy();
  await createDemoPolicy();
  // Fresh activity feed (through the event server if it's running, so open dashboards clear too).
  const viaServer = await fetch(`${EVENTS_URL}/events/reset`, { method: "POST" }).then((r) => r.ok).catch(() => false);
  if (!viaServer) writeFileSync(join(ROOT, "agent", "events.jsonl"), "");
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
