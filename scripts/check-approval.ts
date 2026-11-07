// Approval E2E: agent requests a 0.18 payment (above the 0.15 threshold) → the dashboard shows
// "Needs your approval" → click Approve → the agent gets its data. Needs the demo running.
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };

spawnSync("npx", ["tsx", "scripts/reset-demo.ts"], { stdio: "ignore" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="spent"]');

let out = "";
const agent = spawn("npx", ["tsx", "agent/index.ts", "--mode", "scripted", "--fast", "--approval"]);
agent.stdout.on("data", (d) => (out += d));
const done = new Promise<number>((r) => agent.on("exit", (c) => r(c ?? 1)));

await page.waitForSelector('[data-testid="approve"]', { timeout: 120_000 });
console.log("dashboard shows: Needs your approval");
await page.waitForTimeout(1000);
await page.screenshot({ path: "docs/screenshots/dashboard-approval.png" });
await page.click('[data-testid="approve"]');
console.log("click: Approve");
const code = await done;
if (code !== 0) fail(`agent exited ${code}`);
if (!out.includes("Deep research (owner-approved)")) fail("agent did not receive the approved report");
await page.waitForFunction(() => document.body.textContent?.includes("owner-approved"), null, { timeout: 15_000 });
await page.waitForFunction(() => !document.querySelector('[data-testid="approvals"]'), null, { timeout: 15_000 });
console.log("agent got the report; spend row shows owner-approved; approval card cleared");
console.log(out.split("\n").filter((l) => l.startsWith("Spent")).at(-1));
await browser.close();
if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("PASS");
