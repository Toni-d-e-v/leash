// Local demo signer: lets the dashboard's kill switch act as the owner by running the same CLI
// scripts (`npm run pause|unpause|rotate-agent`), which load .keys/owner.json server-side.
// The key never reaches the browser. Localhost only; disable with LEASH_DEMO_SIGNER=0.
import { NextResponse, type NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "..");
const enabled = () => process.env.LEASH_DEMO_SIGNER !== "0";
const SCRIPTS: Record<string, string[]> = {
  pause: ["scripts/pause.ts", "on"],
  unpause: ["scripts/pause.ts", "off"],
  rotate: ["scripts/rotate-agent.ts"],
};

function isLocal(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ available: enabled() && isLocal(req) });
}

export async function POST(req: NextRequest) {
  if (!enabled() || !isLocal(req)) return NextResponse.json({ error: "demo signer disabled" }, { status: 403 });
  const { action } = await req.json().catch(() => ({ action: "" }));
  const args = SCRIPTS[action];
  if (!args) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const tsx = resolve(ROOT, "node_modules/.bin/tsx");
  return new Promise<NextResponse>((done) => {
    execFile(tsx, args, { cwd: ROOT, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) done(NextResponse.json({ ok: false, error: (stderr || err.message).trim().split("\n").at(-1) }, { status: 500 }));
      else done(NextResponse.json({ ok: true, output: stdout.trim() }));
    });
  });
}
