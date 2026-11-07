// Paid APIs that speak x402 v2 on the wire, settled through the Leash facilitator.
//   no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED (price, mint, recipient, network, nonce, 120s expiry)
//   PAYMENT-SIGNATURE    → facilitator /verify + /settle → 200 + PAYMENT-RESPONSE
import express, { type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import { SERVICES_PORT, SERVICES_URL, readDemoConfig, toBase } from "../shared/config.js";
import { PROGRAM_ID } from "../shared/leash.js";
import {
  HEADER_REQUIRED, HEADER_RESPONSE, HEADER_SIGNATURE, LEASH_SCHEME, X402_VERSION, b64json, unb64json,
  type PaymentPayload, type PaymentRequired, type PaymentRequirements, type SettlementResponse,
} from "../shared/x402.js";
import { facilitatorRouter, getNetwork } from "./facilitator.js";
import { marketData, premiumIntel, summarize } from "./data.js";

const FACILITATOR_URL = process.env.FACILITATOR_URL ?? `${SERVICES_URL}/facilitator`;
const NONCE_TTL = 120;
const issued = new Map<string, { service: string; expiresAt: number }>(); // nonce → binding

const app = express();
app.use(express.json({ limit: "200kb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", `content-type, ${HEADER_SIGNATURE}`);
  res.setHeader("Access-Control-Expose-Headers", `${HEADER_REQUIRED}, ${HEADER_RESPONSE}`);
  next();
});
app.use("/facilitator", await facilitatorRouter());

function requirementsFor(service: string, nonce: string, expiresAt: number): PaymentRequirements {
  const cfg = readDemoConfig();
  const svc = cfg.services.find((s) => s.name === service)!;
  return {
    scheme: LEASH_SCHEME,
    network: getNetwork(),
    amount: toBase(svc.price).toString(),
    asset: cfg.mint,
    payTo: svc.recipient,
    maxTimeoutSeconds: NONCE_TTL,
    extra: { programId: PROGRAM_ID.toBase58(), nonce, expiresAt },
  };
}

function paymentRequired(req: Request, res: Response, service: string, error: string) {
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = Math.floor(Date.now() / 1000) + NONCE_TTL;
  issued.set(nonce, { service, expiresAt });
  const body: PaymentRequired = {
    x402Version: X402_VERSION,
    error,
    resource: { url: `${SERVICES_URL}${req.path}`, description: readDemoConfig().services.find((s) => s.name === service)!.description, mimeType: "application/json", serviceName: service },
    accepts: [requirementsFor(service, nonce, expiresAt)],
  };
  res.status(402).setHeader(HEADER_REQUIRED, b64json(body)).json(body);
}

async function facilitator<T>(path: "verify" | "settle", payload: PaymentPayload, requirements: PaymentRequirements): Promise<T> {
  const r = await fetch(`${FACILITATOR_URL}/${path}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements }),
  });
  return (await r.json()) as T;
}

/** x402 middleware: serve `handler` only after a verified + settled Leash payment. */
function paid(service: string, handler: (req: Request) => Promise<unknown> | unknown) {
  return async (req: Request, res: Response) => {
    const header = req.header(HEADER_SIGNATURE);
    if (!header) return paymentRequired(req, res, service, `${HEADER_SIGNATURE} header is required`);

    let payload: PaymentPayload;
    try { payload = unb64json<PaymentPayload>(header); }
    catch { return res.status(400).json({ error: "invalid_payload", message: "PAYMENT-SIGNATURE is not base64 JSON" }); }

    const nonce = payload.accepted?.extra?.nonce as string | undefined;
    const binding = nonce ? issued.get(nonce) : undefined;
    if (!binding || binding.service !== service) return paymentRequired(req, res, service, "unknown nonce for this resource");
    if (binding.expiresAt < Date.now() / 1000) { issued.delete(nonce!); return paymentRequired(req, res, service, "payment request expired"); }

    const requirements = requirementsFor(service, nonce!, binding.expiresAt);
    const settled = await facilitator<SettlementResponse>("settle", payload, requirements);
    res.setHeader(HEADER_RESPONSE, b64json(settled));
    if (!settled.success) {
      return res.status(402).json({ error: settled.errorReason, message: settled.errorMessage });
    }
    issued.delete(nonce!); // one payment, one response
    console.log(`[${service}] paid ${settled.amount} by policy ${settled.payer} tx ${settled.transaction}`);
    res.json({ service, paid: { transaction: settled.transaction, amount: settled.amount }, data: await handler(req) });
  };
}

app.get("/api/services", (_req, res) => {
  const cfg = readDemoConfig();
  res.json(cfg.services.map(({ name, path, price, description, recipient }) => ({ name, path, price, description, recipient, method: name === "summarize" ? "POST" : "GET" })));
});
app.get("/api/market-data", paid("market-data", () => marketData()));
app.post("/api/summarize", paid("summarize", (req) => summarize(String(req.body?.text ?? ""))));
app.get("/api/premium-intel", paid("premium-intel", () => premiumIntel(readDemoConfig().attacker)));
app.get("/health", (_req, res) => res.json({ ok: true, network: getNetwork() }));

app.listen(SERVICES_PORT, () => console.log(`Leash paid APIs + facilitator on ${SERVICES_URL} (network ${getNetwork()})`));
