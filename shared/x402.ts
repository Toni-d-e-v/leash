// x402 v2 wire types (specs/x402-specification-v2.md, transports-v2/http.md) plus the Leash scheme.
import type { Connection } from "@solana/web3.js";

export const X402_VERSION = 2;
export const HEADER_REQUIRED = "PAYMENT-REQUIRED"; // server → client, base64 PaymentRequired
export const HEADER_SIGNATURE = "PAYMENT-SIGNATURE"; // client → server, base64 PaymentPayload
export const HEADER_RESPONSE = "PAYMENT-RESPONSE"; // server → client, base64 SettlementResponse

/** Scheme name for payments made through a Leash policy `spend`. */
export const LEASH_SCHEME = "leash";

export interface ResourceInfo { url: string; description?: string; mimeType?: string; serviceName?: string }

export interface PaymentRequirements {
  scheme: string;
  network: string; // CAIP-2, e.g. solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1
  amount: string; // atomic units
  asset: string; // mint
  payTo: string; // recipient wallet (owner of the destination token account)
  maxTimeoutSeconds: number;
  extra?: LeashExtra & Record<string, unknown>;
}

/** Scheme-specific `extra` for `leash`. The nonce must be passed as the spend's `request_id`. */
export interface LeashExtra {
  programId: string;
  nonce: string; // 32 bytes hex
  expiresAt: number; // unix seconds
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
}

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  accepted: PaymentRequirements;
  /** `leash` payload: a fully signed transaction containing a Leash `spend`. */
  payload: { transaction: string };
}

export interface VerifyResponse { isValid: boolean; invalidReason?: string; invalidMessage?: string; payer?: string }
export interface SettlementResponse {
  success: boolean; errorReason?: string; errorMessage?: string; payer?: string;
  transaction: string; network: string; amount?: string;
}

export const b64json = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
export const unb64json = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** CAIP-2 id for a Solana cluster: "solana:" + first 32 chars of the genesis hash. */
export async function caip2(conn: Connection): Promise<string> {
  return `solana:${(await conn.getGenesisHash()).slice(0, 32)}`;
}
