// Rotate the agent session key: the old key is revoked instantly.
// Generates a new .keys/agent.json (old one kept as .keys/agent-<ts>.json), funds it, updates the policy.
import { renameSync } from "node:fs";
import { join } from "node:path";
import { LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { currentPolicy, program, sendOwner } from "./lib/policy.js";
import { loadKeypair, ensureKeypair, KEYS_DIR, explorerTx, readDemoConfig, writeDemoConfig, EVENTS_URL } from "../shared/config.js";
import { ix } from "../shared/leash.js";

const { policy } = currentPolicy();
const owner = loadKeypair("owner");
const old = loadKeypair("agent");
renameSync(join(KEYS_DIR, "agent.json"), join(KEYS_DIR, `agent-${Date.now()}.json`));
const { kp: fresh } = ensureKeypair("agent");
const sig = await sendOwner([
  await ix.rotateAgent(program, owner.publicKey, policy, fresh.publicKey),
  SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: fresh.publicKey, lamports: 0.5 * LAMPORTS_PER_SOL }),
], owner);
const cfg = readDemoConfig();
cfg.agent = fresh.publicKey.toBase58();
writeDemoConfig(cfg);
console.log(`Rotated agent ${old.publicKey.toBase58()} → ${fresh.publicKey.toBase58()}\n  ${explorerTx(sig)}`);
await fetch(`${EVENTS_URL}/events`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ type: "owner", action: "rotated", signature: sig, oldAgent: old.publicKey.toBase58(), newAgent: fresh.publicKey.toBase58() }),
}).catch(() => {});
