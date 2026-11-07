// Idempotent setup: keypairs, SOL for fees, a 6-decimal test USDC mint, 100 USDC to the owner,
// token accounts for every recipient, and demo-config.json.
import {
  Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, getMint,
} from "@solana/spl-token";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CLUSTER, RPC_URL, ROOT, SERVICES_URL, EVENTS_URL, connection, ensureKeypair, loadKeypair,
  writeDemoConfig, toBase, fromBase, DEMO_CONFIG_PATH, type DemoConfig,
} from "../shared/config.js";
import { CATALOG } from "../shared/catalog.js";
import { PROGRAM_ID } from "../shared/leash.js";

const conn = connection();

async function ensureSol(who: string, pubkey: PublicKey, min: number) {
  const bal = await conn.getBalance(pubkey);
  if (bal >= min * LAMPORTS_PER_SOL) return;
  const need = min * 2 * LAMPORTS_PER_SOL - bal;
  try {
    const sig = await conn.requestAirdrop(pubkey, need);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`  airdropped ${(need / LAMPORTS_PER_SOL).toFixed(2)} SOL → ${who}`);
    return;
  } catch (e) {
    if (CLUSTER === "localnet") throw e;
  }
  // Devnet fallback: pay from the Solana CLI default keypair (fees only).
  const cliPath = join(homedir(), ".config/solana/id.json");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(cliPath, "utf8"))));
  const amount = Math.round(min * LAMPORTS_PER_SOL - bal + 0.05 * LAMPORTS_PER_SOL);
  await sendAndConfirmTransaction(conn, new Transaction().add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pubkey, lamports: amount })), [payer]);
  console.log(`  transferred ${(amount / LAMPORTS_PER_SOL).toFixed(3)} SOL from CLI wallet → ${who}`);
}

async function main() {
  console.log(`Leash setup on ${CLUSTER} (${RPC_URL})`);
  const programInfo = await conn.getAccountInfo(PROGRAM_ID);
  if (!programInfo?.executable) {
    throw new Error(`Leash program ${PROGRAM_ID.toBase58()} not deployed on ${CLUSTER}. Start the validator (npm run validator) or deploy first.`);
  }

  const names = ["owner", "agent", "attacker", ...CATALOG.map((s) => s.key)];
  for (const n of names) {
    const { kp, created } = ensureKeypair(n);
    console.log(`  ${created ? "created" : "found  "} .keys/${n}.json  ${kp.publicKey.toBase58()}`);
  }
  const owner = loadKeypair("owner");
  const agent = loadKeypair("agent");
  const attacker = loadKeypair("attacker");

  // Fees: owner pays for accounts, agent pays its own tx fees.
  await ensureSol("owner", owner.publicKey, CLUSTER === "devnet" ? 0.5 : 5);
  await ensureSol("agent", agent.publicKey, CLUSTER === "devnet" ? 0.2 : 2);

  // Test USDC mint (6 decimals), recorded per cluster so a localnet reset recreates it.
  const mintFile = join(ROOT, ".keys", `mint-${CLUSTER}.txt`);
  let mint: PublicKey | null = existsSync(mintFile) ? new PublicKey(readFileSync(mintFile, "utf8").trim()) : null;
  if (mint) {
    try { await getMint(conn, mint); } catch { mint = null; }
  }
  if (!mint) {
    mint = await createMint(conn, owner, owner.publicKey, null, 6);
    writeFileSync(mintFile, mint.toBase58());
    console.log(`  created test USDC mint ${mint.toBase58()}`);
  } else {
    console.log(`  found   test USDC mint ${mint.toBase58()}`);
  }

  // Token accounts for owner, every service recipient and the attacker.
  const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
  for (const n of ["attacker", ...CATALOG.map((s) => s.key)]) {
    await getOrCreateAssociatedTokenAccount(conn, owner, mint, loadKeypair(n).publicKey);
  }
  const bal = (await getAccount(conn, ownerAta.address)).amount;
  if (bal < toBase(50)) {
    await mintTo(conn, owner, mint, ownerAta.address, owner, toBase(100) - bal);
    console.log(`  minted test USDC → owner (balance now 100)`);
  } else {
    console.log(`  owner test USDC balance ${fromBase(bal)}`);
  }

  const prev: Partial<DemoConfig> = existsSync(DEMO_CONFIG_PATH) ? JSON.parse(readFileSync(DEMO_CONFIG_PATH, "utf8")) : {};
  const sameCluster = prev.cluster === CLUSTER && prev.mint === mint.toBase58();
  const cfg: DemoConfig = {
    cluster: CLUSTER,
    rpcUrl: RPC_URL,
    programId: PROGRAM_ID.toBase58(),
    mint: mint.toBase58(),
    owner: owner.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    attacker: attacker.publicKey.toBase58(),
    services: CATALOG.map((s) => ({
      name: s.name, path: s.path, price: s.price, allowlisted: s.allowlisted, description: s.description,
      recipient: loadKeypair(s.key).publicKey.toBase58(),
    })),
    policy: sameCluster ? prev.policy : undefined,
    servicesUrl: SERVICES_URL,
    eventsUrl: EVENTS_URL,
  };
  writeDemoConfig(cfg);
  updateEnv({ LEASH_PROGRAM_ID: cfg.programId, USDC_MINT: cfg.mint });
  console.log(`  wrote demo-config.json`);
  console.log("Setup complete.");
}

/** Fill public values into .env (created from .env.example if missing). */
function updateEnv(values: Record<string, string>) {
  const envPath = join(ROOT, ".env");
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : readFileSync(join(ROOT, ".env.example"), "utf8");
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
  }
  writeFileSync(envPath, text, { mode: 0o600 });
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
