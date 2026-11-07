// Browser-side Leash helpers: decode the Policy account and SpendEvents, build owner instructions.
// Layouts mirror programs/leash/src/lib.rs (Anchor/Borsh, little-endian).
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

export interface DemoConfig {
  cluster: "localnet" | "devnet";
  rpcUrl: string;
  programId: string;
  mint: string;
  owner: string;
  agent: string;
  attacker: string;
  services: { name: string; path: string; price: number; recipient: string; allowlisted: boolean; description: string }[];
  policy?: { address: string; policyId: string; vault: string; createdAt: number };
  servicesUrl: string;
  eventsUrl: string;
}

export interface PolicyState {
  owner: string;
  agent: string;
  mint: string;
  policyId: bigint;
  perTxCap: bigint;
  dailyCap: bigint;
  spentInWindow: bigint;
  windowStart: number;
  totalSpent: bigint;
  expiresAt: number;
  paused: boolean;
  allowlist: string[];
  approvalThreshold: bigint; // 0 = never
}

const DISC = {
  policy: [222, 135, 7, 163, 235, 177, 33, 68],
  spendEvent: [53, 88, 173, 183, 74, 205, 27, 182],
  setPaused: [91, 60, 125, 192, 176, 225, 166, 218],
  approveSpend: [248, 201, 151, 15, 28, 162, 112, 90],
  rejectSpend: [30, 241, 174, 105, 69, 228, 23, 119],
};

const eq = (a: Uint8Array, b: number[]) => b.every((v, i) => a[i] === v);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function decodePolicy(data: Uint8Array): PolicyState | null {
  if (data.length < 8 || !eq(data, DISC.policy)) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 8;
  const pk = () => { const p = new PublicKey(data.slice(o, o + 32)).toBase58(); o += 32; return p; };
  const u64 = () => { const x = v.getBigUint64(o, true); o += 8; return x; };
  const i64 = () => { const x = Number(v.getBigInt64(o, true)); o += 8; return x; };
  const owner = pk(), agent = pk(), mint = pk();
  const policyId = u64(), perTxCap = u64(), dailyCap = u64(), spentInWindow = u64();
  const windowStart = i64();
  const totalSpent = u64();
  const expiresAt = i64();
  const paused = data[o] === 1; o += 1;
  const n = v.getUint32(o, true); o += 4;
  const allowlist = Array.from({ length: n }, pk);
  o += 1; // bump
  const approvalThreshold = o + 8 <= data.length ? u64() : BigInt(0);
  return { owner, agent, mint, policyId, perTxCap, dailyCap, spentInWindow, windowStart, totalSpent, expiresAt, paused, allowlist, approvalThreshold };
}

export interface SpendEventData { policy: string; recipient: string; amount: bigint; requestId: string; reasonHash: string; spentInWindow: bigint; ts: number }

/** Parse SpendEvents from "Program data:" log lines. */
export function parseSpendEvents(logs: string[]): SpendEventData[] {
  const out: SpendEventData[] = [];
  for (const line of logs) {
    const m = line.match(/^Program data: (.+)$/);
    if (!m) continue;
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    if (bytes.length < 160 || !eq(bytes, DISC.spendEvent)) continue;
    const v = new DataView(bytes.buffer);
    out.push({
      policy: new PublicKey(bytes.slice(8, 40)).toBase58(),
      recipient: new PublicKey(bytes.slice(40, 72)).toBase58(),
      amount: v.getBigUint64(72, true),
      requestId: hex(bytes.slice(80, 112)),
      reasonHash: hex(bytes.slice(112, 144)),
      spentInWindow: v.getBigUint64(144, true),
      ts: Number(v.getBigInt64(152, true)),
    });
  }
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return hex(new Uint8Array(d));
}

export function setPausedIx(programId: string, owner: PublicKey, policy: PublicKey, paused: boolean) {
  return new TransactionInstruction({
    programId: new PublicKey(programId),
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([...DISC.setPaused, paused ? 1 : 0]),
  });
}

export const usdc = (base: bigint | number) => Number(base) / 1_000_000;
export const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const short = (s: string, n = 4) => (s.length > 2 * n + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

export function explorer(kind: "tx" | "address", id: string, cfg: Pick<DemoConfig, "cluster" | "rpcUrl">) {
  const c = cfg.cluster === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(cfg.rpcUrl)}`;
  return `https://explorer.solana.com/${kind}/${id}?cluster=${c}`;
}

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const ata = (mint: PublicKey, owner: PublicKey) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/** Owner approves or rejects a pending payment (signed by the connected owner wallet). */
export function resolveSpendIx(
  cfg: DemoConfig, owner: PublicKey, approve: boolean,
  a: { pending: string; requester: string; recipient: string },
) {
  const policy = new PublicKey(cfg.policy!.address);
  const mint = new PublicKey(cfg.mint);
  return new TransactionInstruction({
    programId: new PublicKey(cfg.programId),
    keys: [
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: policy, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(a.pending), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(a.requester), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey(cfg.policy!.vault), isSigner: false, isWritable: true },
      { pubkey: ata(mint, new PublicKey(a.recipient)), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(approve ? DISC.approveSpend : DISC.rejectSpend),
  });
}
