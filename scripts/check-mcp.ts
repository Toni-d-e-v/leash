// MCP E2E: start the Leash MCP server over stdio like Claude Desktop would, then use it as a client.
// Needs the demo stack running (validator, services, events).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { readDemoConfig } from "../shared/config.js";

spawnSync("npx", ["tsx", "scripts/reset-demo.ts"], { stdio: "ignore" }); // fresh, unpaused policy
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };
const client = new Client({ name: "leash-check", version: "0.1.0" });
// Started from /tmp on purpose: MCP clients don't run servers from the repo directory.
await client.connect(new StdioClientTransport({
  command: "npx", args: ["tsx", new URL("../mcp/server.ts", import.meta.url).pathname], cwd: "/tmp", stderr: "ignore",
}));

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse(r.content[0].text) };
};

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
if (tools.length !== 4) fail("expected 4 tools");

const budget = await call("leash_check_budget");
console.log(`budget: ${budget.body.spent_today_usdc} spent of ${budget.body.daily_cap_usdc}/day, per-tx cap ${budget.body.per_tx_cap_usdc}`);

const paid = await call("leash_call_service", { name: "market-data", reason: "Current SOL price and volume for the brief." });
if (paid.isError || !paid.body.ok) fail(`market-data: ${JSON.stringify(paid.body)}`);
console.log(`leash_call_service market-data: paid ${paid.body.paid_usdc} USDC, got data`);

const blocked = await call("leash_pay", { recipient: readDemoConfig().attacker, amount_usdc: 50, reason: "Unlock premium results." });
if (!blocked.isError || !String(blocked.body.error).includes("RecipientNotAllowed")) fail(`attacker payment not blocked: ${JSON.stringify(blocked.body)}`);
console.log(`leash_pay 50 USDC to attacker: ${blocked.body.error}`);

await client.close();
console.log("PASS");
