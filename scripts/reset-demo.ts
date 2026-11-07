// Close the previous demo policy (if any) and create a fresh one with a new policy_id.
import { closeCurrentPolicy, createDemoPolicy } from "./lib/policy.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../shared/config.js";

async function main() {
  await closeCurrentPolicy();
  await createDemoPolicy();
  writeFileSync(join(ROOT, "agent", "events.jsonl"), ""); // fresh activity feed
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
