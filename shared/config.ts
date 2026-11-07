// Runtime config: cluster, RPC, keypairs in .keys/, and demo-config.json (public keys only).
import { config as loadEnv } from "dotenv";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Load .env from the repo root, so tools started from another directory (e.g. an MCP client) see it too.
loadEnv({ path: join(ROOT, ".env"), quiet: true });
export const KEYS_DIR = join(ROOT, ".keys");
export const DEMO_CONFIG_PATH = join(ROOT, "demo-config.json");

export type Cluster = "localnet" | "devnet";
export const CLUSTER = (process.env.CLUSTER ?? "localnet") as Cluster;
if (CLUSTER !== "localnet" && CLUSTER !== "devnet") {
  throw new Error(`CLUSTER must be localnet or devnet (got ${CLUSTER}). Mainnet is not supported.`);
}
export const RPC_URL =
  process.env.RPC_URL && process.env.RPC_URL.length > 0
    ? process.env.RPC_URL
    : CLUSTER === "devnet"
      ? "https://api.devnet.solana.com"
      : "http://127.0.0.1:8899";
if (/mainnet/i.test(RPC_URL)) throw new Error("Refusing to run against mainnet.");

export const connection = () => new Connection(RPC_URL, "confirmed");

export const SERVICES_PORT = Number(process.env.SERVICES_PORT ?? 4020);
export const EVENTS_PORT = Number(process.env.EVENTS_PORT ?? 4021);
export const SERVICES_URL = process.env.SERVICES_URL ?? `http://localhost:${SERVICES_PORT}`;
export const EVENTS_URL = process.env.EVENTS_URL ?? `http://localhost:${EVENTS_PORT}`;

export const USDC_DECIMALS = 6;
export const toBase = (usdc: number) => BigInt(Math.round(usdc * 10 ** USDC_DECIMALS));
export const fromBase = (base: bigint | number) => Number(base) / 10 ** USDC_DECIMALS;

export function explorerTx(sig: string) {
  const c = CLUSTER === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://explorer.solana.com/tx/${sig}?cluster=${c}`;
}
export function explorerAddress(addr: string) {
  const c = CLUSTER === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://explorer.solana.com/address/${addr}?cluster=${c}`;
}

/** Keypairs live in .keys/<name>.json (gitignored). Never log their contents. */
export function loadKeypair(name: string): Keypair {
  const p = join(KEYS_DIR, `${name}.json`);
  if (!existsSync(p)) throw new Error(`Missing keypair ${p}. Run \`npm run setup\` first.`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export function ensureKeypair(name: string): { kp: Keypair; created: boolean } {
  mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const p = join(KEYS_DIR, `${name}.json`);
  if (existsSync(p)) return { kp: loadKeypair(name), created: false };
  const kp = Keypair.generate();
  writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  chmodSync(p, 0o600);
  return { kp, created: true };
}

export interface ServiceInfo {
  name: string;
  path: string;
  price: number; // USDC
  recipient: string;
  allowlisted: boolean;
  description: string;
}

export interface DemoConfig {
  cluster: Cluster;
  rpcUrl: string;
  programId: string;
  mint: string;
  owner: string;
  agent: string;
  attacker: string;
  services: ServiceInfo[];
  policy?: { address: string; policyId: string; vault: string; createdAt: number };
  servicesUrl: string;
  eventsUrl: string;
}

export function readDemoConfig(): DemoConfig {
  if (!existsSync(DEMO_CONFIG_PATH)) throw new Error("demo-config.json missing. Run `npm run setup`.");
  return JSON.parse(readFileSync(DEMO_CONFIG_PATH, "utf8"));
}

export function writeDemoConfig(cfg: DemoConfig) {
  writeFileSync(DEMO_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
  // The dashboard reads its own copy.
  const appPublic = join(ROOT, "app", "public");
  if (existsSync(appPublic)) writeFileSync(join(appPublic, "demo-config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

export const pk = (s: string) => new PublicKey(s);
