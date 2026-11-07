// Kill-switch E2E: click "Pause agent" in the dashboard → the agent's next spend fails onchain with
// PolicyPaused → click "Resume agent" → spends work again. Needs `npm run demo` running.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { ROOT } from "../shared/config.js";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };
const agent = () =>
  spawnSync("npx", ["tsx", "scripts/lib/agent-spend-once.ts"], { cwd: ROOT, encoding: "utf8" }).stdout.trim().split("\n").at(-1)!;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="status"]');

console.log(`status: ${await page.textContent('[data-testid="status"]')}`);
console.log("click: Pause agent");
await page.click('[data-testid="kill-switch"]');
await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.toLowerCase().includes("paused"), null, { timeout: 30_000 });
console.log(`status: ${await page.textContent('[data-testid="status"]')}`);

const paused = JSON.parse(agent());
console.log(`agent spend while paused → ${JSON.stringify(paused)}`);
if (paused.ok || !String(paused.error).includes("PolicyPaused")) fail("expected PolicyPaused");
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="rejection-row"]')].some((r) => r.textContent?.includes("PolicyPaused")), null, { timeout: 15_000 });
console.log("dashboard shows red PolicyPaused row");
await page.screenshot({ path: "docs/screenshots/dashboard-paused.png" });

console.log("click: Resume agent");
await page.click('[data-testid="kill-switch"]');
await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.toLowerCase().includes("active"), null, { timeout: 30_000 });
const resumed = JSON.parse(agent());
console.log(`agent spend after resume → ${JSON.stringify(resumed)}`);
if (!resumed.ok) fail("expected spend to succeed after resume");
await browser.close();
if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("PASS");
