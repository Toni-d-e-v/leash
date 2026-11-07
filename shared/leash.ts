// Shared Leash client: PDAs, instruction builders, event + error decoding.
// Used by tests, scripts, services and the agent.
import { AnchorProvider, BorshCoder, EventParser, Program, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { Leash } from "./idl/leash-types.js";

const require = createRequire(import.meta.url);
export const IDL = require("./idl/leash.json");
export const PROGRAM_ID = new PublicKey(IDL.address);
export const coder = new BorshCoder(IDL);

export const ERROR_NAMES: Record<number, string> = Object.fromEntries(
  IDL.errors.map((e: { code: number; name: string }) => [e.code, e.name]),
);

/** Build a Program usable for instruction building and account decoding. */
export function getProgram(connection?: Connection): Program<Leash> {
  const conn = connection ?? new Connection("http://127.0.0.1:8899");
  const provider = new AnchorProvider(conn, new Wallet(Keypair.generate()), {
    commitment: "confirmed",
  });
  return new Program<Leash>(IDL, provider);
}

export function policyPda(owner: PublicKey, policyId: bigint | number): PublicKey {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(BigInt(policyId));
  return PublicKey.findProgramAddressSync([Buffer.from("policy"), owner.toBuffer(), id], PROGRAM_ID)[0];
}

export function pendingPda(policy: PublicKey, requestId: Buffer): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pending"), policy.toBuffer(), requestId], PROGRAM_ID)[0];
}

export function vaultAta(policy: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID): PublicKey {
  return getAssociatedTokenAddressSync(mint, policy, true, tokenProgram);
}

export const sha256 = (s: string | Buffer): Buffer => createHash("sha256").update(s).digest();

export interface PolicyLimits {
  perTxCap: bigint;
  dailyCap: bigint;
  expiresAt: bigint; // unix seconds, 0 = never
}

export const ix = {
  createPolicy(
    program: Program<Leash>,
    a: { owner: PublicKey; mint: PublicKey; policyId: bigint; agent: PublicKey; allowlist: PublicKey[] } & PolicyLimits,
    tokenProgram = TOKEN_PROGRAM_ID,
  ): Promise<TransactionInstruction> {
    const policy = policyPda(a.owner, a.policyId);
    return program.methods
      .createPolicy(new BN(a.policyId.toString()), a.agent, new BN(a.perTxCap.toString()), new BN(a.dailyCap.toString()), new BN(a.expiresAt.toString()), a.allowlist)
      .accountsStrict({
        owner: a.owner,
        policy,
        mint: a.mint,
        vault: vaultAta(policy, a.mint, tokenProgram),
        tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .instruction();
  },

  ownerTransferAccounts(owner: PublicKey, policy: PublicKey, mint: PublicKey, tokenProgram = TOKEN_PROGRAM_ID) {
    return {
      owner,
      policy,
      mint,
      vault: vaultAta(policy, mint, tokenProgram),
      ownerToken: getAssociatedTokenAddressSync(mint, owner, false, tokenProgram),
      tokenProgram,
    };
  },

  deposit(program: Program<Leash>, owner: PublicKey, policy: PublicKey, mint: PublicKey, amount: bigint) {
    return program.methods.deposit(new BN(amount.toString())).accountsStrict(ix.ownerTransferAccounts(owner, policy, mint)).instruction();
  },

  withdraw(program: Program<Leash>, owner: PublicKey, policy: PublicKey, mint: PublicKey, amount: bigint) {
    return program.methods.withdraw(new BN(amount.toString())).accountsStrict(ix.ownerTransferAccounts(owner, policy, mint)).instruction();
  },

  closePolicy(program: Program<Leash>, owner: PublicKey, policy: PublicKey, mint: PublicKey) {
    return program.methods.closePolicy().accountsStrict(ix.ownerTransferAccounts(owner, policy, mint)).instruction();
  },

  /** Agent-signed spend to `recipient` wallet's ATA. */
  spend(
    program: Program<Leash>,
    a: { agent: PublicKey; policy: PublicKey; mint: PublicKey; recipient: PublicKey; amount: bigint; requestId: Buffer; reasonHash: Buffer },
    tokenProgram = TOKEN_PROGRAM_ID,
  ) {
    return program.methods
      .spend(new BN(a.amount.toString()), [...a.requestId], [...a.reasonHash])
      .accountsStrict({
        agent: a.agent,
        policy: a.policy,
        mint: a.mint,
        vault: vaultAta(a.policy, a.mint, tokenProgram),
        recipientToken: getAssociatedTokenAddressSync(a.mint, a.recipient, true, tokenProgram),
        tokenProgram,
      })
      .instruction();
  },

  /** Agent asks the owner to approve a payment above the approval threshold. */
  requestSpend(
    program: Program<Leash>,
    a: { agent: PublicKey; policy: PublicKey; mint: PublicKey; recipient: PublicKey; amount: bigint; requestId: Buffer; reasonHash: Buffer },
    tokenProgram = TOKEN_PROGRAM_ID,
  ) {
    return program.methods
      .requestSpend(new BN(a.amount.toString()), [...a.requestId], [...a.reasonHash])
      .accountsStrict({
        agent: a.agent,
        policy: a.policy,
        pending: pendingPda(a.policy, a.requestId),
        recipientToken: getAssociatedTokenAddressSync(a.mint, a.recipient, true, tokenProgram),
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .instruction();
  },

  /** Owner approves (`approve`) or rejects a pending payment. */
  resolveSpend(
    program: Program<Leash>,
    approve: boolean,
    a: { owner: PublicKey; policy: PublicKey; mint: PublicKey; pending: PublicKey; requester: PublicKey; recipientToken: PublicKey },
    tokenProgram = TOKEN_PROGRAM_ID,
  ) {
    const accounts = {
      owner: a.owner, policy: a.policy, pending: a.pending, requester: a.requester, mint: a.mint,
      vault: vaultAta(a.policy, a.mint, tokenProgram), recipientToken: a.recipientToken, tokenProgram,
    };
    return (approve ? program.methods.approveSpend() : program.methods.rejectSpend()).accountsStrict(accounts).instruction();
  },

  setApprovalThreshold(program: Program<Leash>, owner: PublicKey, policy: PublicKey, threshold: bigint) {
    return program.methods.setApprovalThreshold(new BN(threshold.toString())).accountsStrict({ owner, policy }).instruction();
  },

  setPaused(program: Program<Leash>, owner: PublicKey, policy: PublicKey, paused: boolean) {
    return program.methods.setPaused(paused).accountsStrict({ owner, policy }).instruction();
  },
  rotateAgent(program: Program<Leash>, owner: PublicKey, policy: PublicKey, newAgent: PublicKey) {
    return program.methods.rotateAgent(newAgent).accountsStrict({ owner, policy }).instruction();
  },
  setAllowlist(program: Program<Leash>, owner: PublicKey, policy: PublicKey, list: PublicKey[]) {
    return program.methods.setAllowlist(list).accountsStrict({ owner, policy }).instruction();
  },
  updateLimits(program: Program<Leash>, owner: PublicKey, policy: PublicKey, l: PolicyLimits) {
    return program.methods
      .updateLimits(new BN(l.perTxCap.toString()), new BN(l.dailyCap.toString()), new BN(l.expiresAt.toString()))
      .accountsStrict({ owner, policy })
      .instruction();
  },
};

export interface SpendEventData {
  policy: string;
  recipient: string;
  amount: bigint;
  requestId: string; // hex
  reasonHash: string; // hex
  spentInWindow: bigint;
  ts: number;
}

/** Parse SpendEvents emitted by the Leash program from transaction logs. */
export function parseSpendEvents(logs: string[]): SpendEventData[] {
  const parser = new EventParser(PROGRAM_ID, coder);
  const out: SpendEventData[] = [];
  for (const ev of parser.parseLogs(logs)) {
    if (ev.name !== "spendEvent" && ev.name !== "SpendEvent") continue;
    const d = ev.data as any;
    out.push({
      policy: d.policy.toBase58(),
      recipient: d.recipient.toBase58(),
      amount: BigInt(d.amount.toString()),
      requestId: Buffer.from(d.requestId ?? d.request_id).toString("hex"),
      reasonHash: Buffer.from(d.reasonHash ?? d.reason_hash).toString("hex"),
      spentInWindow: BigInt((d.spentInWindow ?? d.spent_in_window).toString()),
      ts: Number((d.ts).toString()),
    });
  }
  return out;
}

/** Find the Leash error name in logs or an error object, e.g. "RecipientNotAllowed". */
export function decodeLeashError(errOrLogs: unknown): string | null {
  const text = Array.isArray(errOrLogs)
    ? errOrLogs.join("\n")
    : errOrLogs instanceof Error
      ? `${errOrLogs.message}\n${((errOrLogs as any).logs ?? []).join("\n")}\n${((errOrLogs as any).transactionLogs ?? []).join("\n")}`
      : String(errOrLogs);
  const named = text.match(/Error Code: (\w+)/);
  if (named) return named[1];
  const hex = text.match(/custom program error: (0x[0-9a-fA-F]+)/);
  if (hex) {
    const code = parseInt(hex[1], 16);
    return ERROR_NAMES[code] ?? `Custom(${code})`;
  }
  const json = text.match(/"Custom":\s*(\d+)/);
  if (json) return ERROR_NAMES[Number(json[1])] ?? `Custom(${json[1]})`;
  return null;
}

export type PolicyAccount = Awaited<ReturnType<Program<Leash>["account"]["policy"]["fetch"]>>;
