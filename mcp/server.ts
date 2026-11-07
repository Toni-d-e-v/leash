// Leash MCP server: gives any MCP client (Claude Desktop, Claude Code, Cursor, ...) a wallet with a leash.
// The client gets the same four tools as the demo agent. They sign with the agent session key only;
// caps, allowlist, approvals and the kill switch are enforced by the Leash program, not by this server.
//
//   claude mcp add leash -- npx tsx /path/to/leash/mcp/server.ts
import "./stdio-guard.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { agentKey, callService, checkBudget, emit, listServices, pay } from "../agent/tools.js";

const server = new McpServer({ name: "leash", version: "0.1.0" });

const reason = z.string().min(1).describe("One sentence: why this payment is worth it. Hashed onchain and shown to the owner.");
const asJson = (value: unknown, isError = false) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  isError,
});

server.registerTool("leash_list_services", {
  title: "List paid APIs",
  description: "List the x402 paid APIs this wallet can call, with prices in USDC.",
  annotations: { readOnlyHint: true },
}, async () => asJson(await listServices()));

server.registerTool("leash_check_budget", {
  title: "Check budget",
  description: "Read the Leash policy onchain: per-transaction cap, daily cap, spent today, remaining, vault balance, paused/expired.",
  annotations: { readOnlyHint: true },
}, async () => asJson(await checkBudget()));

server.registerTool("leash_call_service", {
  title: "Call a paid API",
  description:
    "Call a paid API by name. On HTTP 402 it pays the quoted price through the Leash policy and retries. " +
    "Payments above the owner's approval threshold wait for the owner's decision. Returns the data or the policy error.",
  inputSchema: {
    name: z.string().describe("Service name from leash_list_services"),
    params: z.object({ text: z.string().optional() }).passthrough().optional().describe("Request body for POST services, e.g. {\"text\": \"...\"} for summarize"),
    reason,
  },
  annotations: { openWorldHint: true },
}, async (a) => {
  const out = await callService(a);
  return asJson(out, (out as any).ok === false);
});

server.registerTool("leash_pay", {
  title: "Pay an address",
  description: "Send USDC from the Leash wallet to a Solana address. The Leash program enforces caps and a recipient allowlist; rejected payments return the policy error.",
  inputSchema: {
    recipient: z.string().describe("Recipient wallet address (base58)"),
    amount_usdc: z.number().positive(),
    reason,
  },
  annotations: { destructiveHint: true, openWorldHint: true },
}, async (a) => {
  const out = await pay(a);
  return asJson(out, out.ok === false);
});

await server.connect(new StdioServerTransport());
await emit({ type: "run", status: "started", mode: "mcp", task: "MCP client connected", agent: agentKey.publicKey.toBase58() });
console.error(`Leash MCP server ready (agent ${agentKey.publicKey.toBase58()})`);
