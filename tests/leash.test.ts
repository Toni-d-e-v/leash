// Leash program tests on LiteSVM (in-process SVM with clock warping).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { LiteSVM, Clock, TransactionMetadata, FailedTransactionMetadata } from "litesvm";
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  AccountLayout,
  createInitializeMint2Instruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { randomBytes } from "node:crypto";
import { getProgram, ix, policyPda, pendingPda, vaultAta, sha256, parseSpendEvents, decodeLeashError, coder } from "../shared/leash.js";

const USDC = (n: number) => BigInt(Math.round(n * 1_000_000));
const DAY = 86_400n;
const program = getProgram();

function setup(opts: { expiresIn?: bigint } = {}) {
  const svm = new LiteSVM();
  svm.addProgramFromFile(program.programId, "target/deploy/leash.so");
  const [owner, agent, apiA, apiB, attacker, mintKp] = Array.from({ length: 6 }, () => Keypair.generate());
  for (const k of [owner, agent, attacker]) svm.airdrop(k.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
  const mint = mintKp.publicKey;

  const send = (ixs: TransactionInstruction[], signers: Keypair[]) => {
    const tx = new Transaction();
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = signers[0].publicKey;
    tx.add(...ixs);
    tx.sign(...signers);
    const res = svm.sendTransaction(tx);
    svm.expireBlockhash();
    return res;
  };
  const ok = (res: TransactionMetadata | FailedTransactionMetadata) => {
    if (res instanceof FailedTransactionMetadata) assert.fail(`tx failed: ${res.toString()}\n${res.meta().logs().join("\n")}`);
    return res as TransactionMetadata;
  };
  const fails = (res: TransactionMetadata | FailedTransactionMetadata, name: string) => {
    assert.ok(res instanceof FailedTransactionMetadata, `expected ${name}, but tx succeeded`);
    assert.equal(decodeLeashError(res.meta().logs()), name);
  };
  const balance = (wallet: PublicKey, owner_is_pda = false) => {
    const acc = svm.getAccount(getAssociatedTokenAddressSync(mint, wallet, owner_is_pda));
    return acc ? AccountLayout.decode(Buffer.from(acc.data)).amount : 0n;
  };
  const now = () => svm.getClock().unixTimestamp;
  const warp = (secs: bigint) => {
    const c = svm.getClock();
    svm.setClock(new Clock(c.slot + 1n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, c.unixTimestamp + secs));
  };

  // Mint + token accounts
  const rent = svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE));
  ok(send([
    SystemProgram.createAccount({ fromPubkey: owner.publicKey, newAccountPubkey: mint, lamports: Number(rent), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, 6, owner.publicKey, null),
    ...[owner, apiA, apiB, attacker].map((k) =>
      createAssociatedTokenAccountInstruction(owner.publicKey, getAssociatedTokenAddressSync(mint, k.publicKey), k.publicKey, mint)),
    createMintToInstruction(mint, getAssociatedTokenAddressSync(mint, owner.publicKey), owner.publicKey, USDC(100)),
  ], [owner, mintKp]));

  return { svm, owner, agent, apiA, apiB, attacker, mint, send, ok, fails, balance, now, warp };
}

async function withPolicy(opts: { perTx?: number; daily?: number; expiresIn?: bigint; never?: boolean; fund?: number } = {}) {
  const e = setup();
  const policyId = 1n;
  const policy = policyPda(e.owner.publicKey, policyId);
  const expiresAt = opts.never ? 0n : e.now() + (opts.expiresIn ?? DAY);
  e.ok(e.send([
    await ix.createPolicy(program, {
      owner: e.owner.publicKey, mint: e.mint, policyId, agent: e.agent.publicKey,
      perTxCap: USDC(opts.perTx ?? 0.2), dailyCap: USDC(opts.daily ?? 1), expiresAt,
      allowlist: [e.apiA.publicKey, e.apiB.publicKey],
    }),
    await ix.deposit(program, e.owner.publicKey, policy, e.mint, USDC(opts.fund ?? 5)),
  ], [e.owner]));

  const spend = async (amount: bigint, recipient = e.apiA.publicKey, signer = e.agent, reason = "test payment") =>
    e.send([await ix.spend(program, {
      agent: signer.publicKey, policy, mint: e.mint, recipient, amount,
      requestId: randomBytes(32), reasonHash: sha256(reason),
    })], [signer]);
  const state = () => coder.accounts.decode("Policy", Buffer.from(e.svm.getAccount(policy)!.data));
  return { ...e, policy, spend, state };
}

describe("leash", () => {
  test("happy path: create → deposit → spend emits SpendEvent", async () => {
    const t = await withPolicy();
    assert.equal(t.balance(t.policy, true), USDC(5));
    const requestId = randomBytes(32);
    const reason = "Need SOL market data for the brief.";
    const res = t.ok(t.send([await ix.spend(program, {
      agent: t.agent.publicKey, policy: t.policy, mint: t.mint, recipient: t.apiA.publicKey,
      amount: USDC(0.05), requestId, reasonHash: sha256(reason),
    })], [t.agent]));

    assert.equal(t.balance(t.apiA.publicKey), USDC(0.05));
    assert.equal(t.balance(t.policy, true), USDC(4.95));
    const [ev] = parseSpendEvents(res.logs());
    assert.equal(ev.recipient, t.apiA.publicKey.toBase58());
    assert.equal(ev.amount, USDC(0.05));
    assert.equal(ev.requestId, requestId.toString("hex"));
    assert.equal(ev.reasonHash, sha256(reason).toString("hex"));
    const s = t.state();
    assert.equal(s.spent_in_window.toString(), USDC(0.05).toString());
    assert.equal(s.total_spent.toString(), USDC(0.05).toString());
  });

  test("PolicyPaused: agent can't spend while paused, owner can still withdraw", async () => {
    const t = await withPolicy();
    t.ok(t.send([await ix.setPaused(program, t.owner.publicKey, t.policy, true)], [t.owner]));
    t.fails(await t.spend(USDC(0.05)), "PolicyPaused");
    t.ok(t.send([await ix.withdraw(program, t.owner.publicKey, t.policy, t.mint, USDC(1))], [t.owner]));
    assert.equal(t.balance(t.policy, true), USDC(4));
    t.ok(t.send([await ix.setPaused(program, t.owner.publicKey, t.policy, false)], [t.owner]));
    t.ok(await t.spend(USDC(0.05)));
  });

  test("PolicyExpired after expires_at", async () => {
    const t = await withPolicy({ expiresIn: 3600n });
    t.ok(await t.spend(USDC(0.05)));
    t.warp(3601n);
    t.fails(await t.spend(USDC(0.05)), "PolicyExpired");
  });

  test("UnauthorizedAgent: a non-agent signer can't spend (owner included)", async () => {
    const t = await withPolicy();
    t.fails(await t.spend(USDC(0.05), t.apiA.publicKey, t.attacker), "UnauthorizedAgent");
    t.fails(await t.spend(USDC(0.05), t.apiA.publicKey, t.owner), "UnauthorizedAgent");
  });

  test("RecipientNotAllowed: the injected 50 USDC payment to the attacker is blocked", async () => {
    const t = await withPolicy();
    t.fails(await t.spend(USDC(50), t.attacker.publicKey), "RecipientNotAllowed");
    t.fails(await t.spend(USDC(0.01), t.attacker.publicKey), "RecipientNotAllowed");
    assert.equal(t.balance(t.attacker.publicKey), 0n);
    assert.equal(t.balance(t.policy, true), USDC(5));
  });

  test("OverPerTxCap: above cap and zero amount", async () => {
    const t = await withPolicy();
    t.fails(await t.spend(USDC(0.21)), "OverPerTxCap");
    t.fails(await t.spend(0n), "OverPerTxCap");
    t.ok(await t.spend(USDC(0.2)));
  });

  test("OverDailyCap: budget is enforced across spends", async () => {
    const t = await withPolicy();
    for (let i = 0; i < 5; i++) t.ok(await t.spend(USDC(0.2), i % 2 ? t.apiA.publicKey : t.apiB.publicKey));
    t.fails(await t.spend(USDC(0.01)), "OverDailyCap");
  });

  test("window resets after 24h", async () => {
    const t = await withPolicy({ never: true });
    for (let i = 0; i < 5; i++) t.ok(await t.spend(USDC(0.2)));
    t.fails(await t.spend(USDC(0.2)), "OverDailyCap");
    t.warp(DAY - 10n);
    t.fails(await t.spend(USDC(0.2)), "OverDailyCap");
    t.warp(10n);
    t.ok(await t.spend(USDC(0.2)));
    const s = t.state();
    assert.equal(s.spent_in_window.toString(), USDC(0.2).toString());
    assert.equal(s.total_spent.toString(), USDC(1.2).toString());
  });

  test("rotate_agent: old key fails, new key works", async () => {
    const t = await withPolicy();
    const fresh = Keypair.generate();
    t.svm.airdrop(fresh.publicKey, BigInt(LAMPORTS_PER_SOL));
    t.ok(t.send([await ix.rotateAgent(program, t.owner.publicKey, t.policy, fresh.publicKey)], [t.owner]));
    t.fails(await t.spend(USDC(0.05)), "UnauthorizedAgent");
    t.ok(await t.spend(USDC(0.05), t.apiA.publicKey, fresh));
  });

  test("only the owner can change the policy", async () => {
    const t = await withPolicy();
    const res = t.send([await ix.setPaused(program, t.agent.publicKey, t.policy, true)], [t.agent]);
    assert.ok(res instanceof FailedTransactionMetadata);
    assert.match(res.meta().logs().join("\n"), /ConstraintHasOne/);
  });

  test("AllowlistTooLong: max 8 entries", async () => {
    const t = await withPolicy();
    const nine = Array.from({ length: 9 }, () => Keypair.generate().publicKey);
    t.fails(t.send([await ix.setAllowlist(program, t.owner.publicKey, t.policy, nine)], [t.owner]), "AllowlistTooLong");
    t.ok(t.send([await ix.setAllowlist(program, t.owner.publicKey, t.policy, nine.slice(0, 8))], [t.owner]));
    // the old recipients are gone now
    t.fails(await t.spend(USDC(0.05)), "RecipientNotAllowed");
  });

  test("InvalidLimits: per-tx cap must be > 0 and <= daily cap", async () => {
    const t = await withPolicy();
    t.fails(t.send([await ix.updateLimits(program, t.owner.publicKey, t.policy, { perTxCap: USDC(2), dailyCap: USDC(1), expiresAt: 0n })], [t.owner]), "InvalidLimits");
    t.fails(t.send([await ix.updateLimits(program, t.owner.publicKey, t.policy, { perTxCap: 0n, dailyCap: USDC(1), expiresAt: 0n })], [t.owner]), "InvalidLimits");
  });

  test("close_policy drains the vault to the owner and closes accounts", async () => {
    const t = await withPolicy();
    t.ok(await t.spend(USDC(0.1)));
    t.ok(t.send([await ix.closePolicy(program, t.owner.publicKey, t.policy, t.mint)], [t.owner]));
    assert.equal(t.svm.getAccount(t.policy)?.lamports ?? 0, 0);
    assert.equal(t.svm.getAccount(vaultAta(t.policy, t.mint))?.lamports ?? 0, 0);
    assert.equal(t.balance(t.owner.publicKey), USDC(99.9));
  });

  describe("approval threshold", () => {
    async function withThreshold(threshold = 0.15) {
      const t = await withPolicy();
      t.ok(t.send([await ix.setApprovalThreshold(program, t.owner.publicKey, t.policy, USDC(threshold))], [t.owner]));
      const request = async (amount: bigint, recipient = t.apiA.publicKey, signer = t.agent) => {
        const requestId = randomBytes(32);
        const res = t.send([await ix.requestSpend(program, {
          agent: signer.publicKey, policy: t.policy, mint: t.mint, recipient, amount, requestId, reasonHash: sha256("big one"),
        })], [signer]);
        return { res, requestId, pending: pendingPda(t.policy, requestId) };
      };
      const resolve = async (approve: boolean, pending: PublicKey, recipient = t.apiA.publicKey, signer = t.owner) =>
        t.send([await ix.resolveSpend(program, approve, {
          owner: signer.publicKey, policy: t.policy, mint: t.mint, pending, requester: t.agent.publicKey,
          recipientToken: getAssociatedTokenAddressSync(t.mint, recipient),
        })], [signer]);
      return { ...t, request, resolve };
    }

    test("spend above the threshold needs approval; below works", async () => {
      const t = await withThreshold();
      t.fails(await t.spend(USDC(0.18)), "NeedsApproval");
      t.ok(await t.spend(USDC(0.15)));
    });

    test("request → owner approves → paid, SpendEvent emitted, pending closed", async () => {
      const t = await withThreshold();
      const { res, requestId, pending } = await t.request(USDC(0.18));
      t.ok(res);
      assert.equal(t.balance(t.apiA.publicKey), 0n);
      const approved = t.ok(await t.resolve(true, pending));
      assert.equal(t.balance(t.apiA.publicKey), USDC(0.18));
      const [ev] = parseSpendEvents(approved.logs());
      assert.equal(ev.requestId, requestId.toString("hex"));
      assert.equal(ev.amount, USDC(0.18));
      assert.equal(t.svm.getAccount(pending)?.lamports ?? 0, 0);
      assert.equal(t.state().spent_in_window.toString(), USDC(0.18).toString());
    });

    test("owner rejects: nothing moves, pending closed", async () => {
      const t = await withThreshold();
      const { pending } = await t.request(USDC(0.18));
      t.ok(await t.resolve(false, pending));
      assert.equal(t.balance(t.apiA.publicKey), 0n);
      assert.equal(t.svm.getAccount(pending)?.lamports ?? 0, 0);
    });

    test("requests still obey the rules; only the owner can approve", async () => {
      const t = await withThreshold();
      t.fails((await t.request(USDC(0.18), t.attacker.publicKey)).res, "RecipientNotAllowed");
      t.fails((await t.request(USDC(0.5))).res, "OverPerTxCap");
      t.fails((await t.request(USDC(0.1))).res, "ApprovalNotRequired");
      t.fails((await t.request(USDC(0.18), t.apiA.publicKey, t.attacker)).res, "UnauthorizedAgent");
      const { pending } = await t.request(USDC(0.18));
      const res = await t.resolve(true, pending, t.apiA.publicKey, t.agent);
      assert.ok(res instanceof FailedTransactionMetadata);
    });

    test("approval re-checks the daily cap at approval time", async () => {
      const t = await withThreshold();
      const { pending } = await t.request(USDC(0.18));
      for (let i = 0; i < 6; i++) t.ok(await t.spend(USDC(0.15)));
      t.fails(await t.resolve(true, pending), "OverDailyCap");
    });
  });
});
