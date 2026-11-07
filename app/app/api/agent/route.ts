// Local demo runner: the dashboard's "Run agent" button starts the same agent as `npm run agent`.
// The agent uses its own session key from .keys/; nothing secret passes through the browser.
// Localhost only; disabled together with the demo signer (LEASH_DEMO_SIGNER=0).
import { NextResponse, type NextRequest } from "next/server";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "..");
const enabled = () => process.env.LEASH_DEMO_SIGNER !== "0";
let child: ChildProcess | null = null;

function isLocal(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

/** Whether the agent would run with Claude: an ANTHROPIC_API_KEY in the environment or the repo's .env. */
function hasKey() {
  if (process.env.ANTHROPIC_API_KEY) return true;
  const env = resolve(ROOT, ".env");
  return existsSync(env) && /^ANTHROPIC_API_KEY=\S+/m.test(readFileSync(env, "utf8"));
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ available: enabled() && isLocal(req), running: !!child, mode: hasKey() ? "llm" : "scripted" });
}

export async function POST(req: NextRequest) {
  if (!enabled() || !isLocal(req)) return NextResponse.json({ error: "demo runner disabled" }, { status: 403 });
  if (child) return NextResponse.json({ error: "the agent is already running" }, { status: 409 });
  const { approval } = await req.json().catch(() => ({}));
  const mode = hasKey() ? "llm" : "scripted";
  // In LLM mode, --force-injection makes sure the onchain block is shown even if Claude refuses the injection.
  const args = ["agent/index.ts", "--mode", mode, mode === "llm" ? "--force-injection" : ""];
  if (approval === true && mode === "scripted") args.push("--approval");
  child = spawn(resolve(ROOT, "node_modules/.bin/tsx"), args.filter(Boolean), { cwd: ROOT, stdio: "ignore" });
  child.on("exit", () => { child = null; });
  child.on("error", () => { child = null; });
  return NextResponse.json({ ok: true, mode });
}
