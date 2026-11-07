// Owner-side policy operations shared by the CLI scripts.
import { Transaction, TransactionInstruction, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import { connection, loadKeypair, readDemoConfig, writeDemoConfig, toBase, pk, explorerTx } from "../../shared/config.js";
import { getProgram, ix, policyPda, vaultAta } from "../../shared/leash.js";

export const conn = connection();
export const program = getProgram(conn);

export async function sendOwner(ixs: TransactionInstruction[], owner: Keypair = loadKeypair("owner")) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [owner], { commitment: "confirmed" });
}

/** Demo policy: 0.20/tx, 1.00/day, allowlist = allowlisted services, expires in 24h, funded with 5 USDC. */
export async function createDemoPolicy() {
  const cfg = readDemoConfig();
  const owner = loadKeypair("owner");
  const mint = pk(cfg.mint);
  const policyId = BigInt(Date.now());
  const policy = policyPda(owner.publicKey, policyId);
  const allowlist = cfg.services.filter((s) => s.allowlisted).map((s) => pk(s.recipient));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86_400);

  const sig = await sendOwner([
    await ix.createPolicy(program, {
      owner: owner.publicKey, mint, policyId, agent: pk(cfg.agent),
      perTxCap: toBase(0.2), dailyCap: toBase(1), expiresAt, allowlist,
    }),
    await ix.deposit(program, owner.publicKey, policy, mint, toBase(5)),
  ], owner);

  cfg.policy = { address: policy.toBase58(), policyId: policyId.toString(), vault: vaultAta(policy, mint).toBase58(), createdAt: Date.now() };
  writeDemoConfig(cfg);
  console.log(`Created policy ${policy.toBase58()} (id ${policyId}), funded 5 test USDC`);
  console.log(`  ${explorerTx(sig)}`);
  return cfg.policy;
}

export async function closeCurrentPolicy() {
  const cfg = readDemoConfig();
  if (!cfg.policy) return false;
  const policy = pk(cfg.policy.address);
  if (!(await conn.getAccountInfo(policy))) {
    console.log(`Old policy ${cfg.policy.address} not found onchain, skipping close`);
  } else {
    const owner = loadKeypair("owner");
    await sendOwner([await ix.closePolicy(program, owner.publicKey, policy, pk(cfg.mint))], owner);
    console.log(`Closed policy ${cfg.policy.address} (vault drained back to owner, rent refunded)`);
  }
  delete cfg.policy;
  writeDemoConfig(cfg);
  return true;
}

export function currentPolicy() {
  const cfg = readDemoConfig();
  if (!cfg.policy) throw new Error("No demo policy. Run `npm run reset-demo`.");
  return { cfg, policy: pk(cfg.policy.address) };
}
