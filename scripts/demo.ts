// One-command demo: validator (localnet) → setup → fresh policy → services + event feed + dashboard → agent.
//   npm run demo              keeps the servers running after the agent finishes (Ctrl-C to stop)
//   npm run demo -- --once    exits after the agent run (used for end-to-end checks)
//   flags: --mode llm|scripted, --force-injection, --delay <seconds before the agent starts>, --no-agent
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { parseArgs } from "node:util";
import { CLUSTER, RPC_URL, SERVICES_PORT, EVENTS_PORT, ROOT } from "../shared/config.js";

const { values } = parseArgs({
  options: {
    once: { type: "boolean", default: false },
    "no-agent": { type: "boolean", default: false },
    mode: { type: "string" },
    "force-injection": { type: "boolean", default: false },
    delay: { type: "string", default: process.env.DEMO_AGENT_DELAY ?? "6" },
  },
});
const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT ?? 3000);
const children: ChildProcess[] = [];
const colors: Record<string, string> = { validator: "90", services: "36", events: "35", dashboard: "34", agent: "33" };

function prefixed(name: string, cmd: string, args: string[]) {
  const child = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const tag = `\x1b[${colors[name] ?? "37"}m[${name}]\x1b[0m `;
  const pipe = (s: NodeJS.ReadableStream) => {
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const l of lines) if (l.trim()) process.stdout.write(tag + l + "\n");
    });
  };
  pipe(child.stdout!); pipe(child.stderr!);
  children.push(child);
  return child;
}

const up = async (url: string, init?: RequestInit) => {
  try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(1500) }); return r.status < 500; } catch { return false; }
};
const rpcUp = () => up(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' });
async function waitFor(name: string, check: () => Promise<boolean>, secs = 90) {
  for (let i = 0; i < secs * 2; i++) { if (await check()) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error(`${name} did not come up within ${secs}s`);
}
function run(label: string, script: string, extra: string[] = []) {
  console.log(`\n▶ ${label}`);
  const r = spawnSync("npx", ["tsx", script, ...extra], { cwd: ROOT, stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${label} failed`);
}

async function main() {
  console.log(`Leash demo on ${CLUSTER} (${RPC_URL})`);
  if (!(await rpcUp())) {
    if (CLUSTER !== "localnet") throw new Error(`RPC ${RPC_URL} is not reachable`);
    console.log("▶ starting local validator with the Leash program");
    prefixed("validator", "bash", ["scripts/validator.sh"]);
    await waitFor("validator", rpcUp);
  }

  run("setup (idempotent)", "scripts/setup.ts");
  run("fresh demo policy", "scripts/reset-demo.ts");

  const services = { name: "services", url: `http://localhost:${SERVICES_PORT}/health`, args: ["tsx", "services/server.ts"] };
  const events = { name: "events", url: `http://localhost:${EVENTS_PORT}/events`, args: ["tsx", "agent/events-server.ts"] };
  for (const s of [services, events]) {
    if (await up(s.url)) console.log(`✓ ${s.name} already running`);
    else prefixed(s.name, "npx", s.args);
  }
  const dashUrl = `http://localhost:${DASHBOARD_PORT}`;
  if (await up(dashUrl)) console.log("✓ dashboard already running");
  else prefixed("dashboard", "npm", ["--prefix", "app", "run", "dev", "--", "-p", String(DASHBOARD_PORT)]);

  await Promise.all([waitFor("services", () => up(services.url)), waitFor("events", () => up(events.url)), waitFor("dashboard", () => up(dashUrl), 120)]);
  await fetch(`${dashUrl}/`).catch(() => {}); // warm up the first compile

  if (values["no-agent"]) {
    console.log(`\n\x1b[1m  Dashboard → ${dashUrl}\x1b[0m\n  Run the agent yourself: npm run agent -- --mode scripted   (Ctrl-C here stops the servers)\n`);
    return;
  }
  console.log(`\n\x1b[1m  Dashboard → ${dashUrl}\x1b[0m\n  Agent starts in ${values.delay}s…\n`);
  await new Promise((r) => setTimeout(r, Number(values.delay) * 1000));

  const agentArgs = ["tsx", "agent/index.ts"];
  if (values.mode) agentArgs.push("--mode", values.mode);
  if (values["force-injection"]) agentArgs.push("--force-injection");
  const agent = prefixed("agent", "npx", agentArgs);
  const code: number = await new Promise((r) => agent.on("exit", (c) => r(c ?? 1)));
  console.log(`\nAgent finished (exit ${code}). Dashboard: ${dashUrl}`);

  if (values.once) { shutdown(code); return; }
  console.log("Servers keep running. Try the kill switch, then `npm run agent` again. Ctrl-C to stop.");
}

function shutdown(code = 0) {
  for (const c of children) { try { process.kill(-c.pid!, "SIGTERM"); } catch { /* already gone */ } }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
main().catch((e) => { console.error(e.message ?? e); shutdown(1); });
