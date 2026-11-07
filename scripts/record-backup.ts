// Records a backup demo video of the dashboard (Playwright screen recording, no audio):
// fresh policy → agent run (spends tick up, injection blocked) → onchain receipt of the failed tx →
// kill switch → PolicyPaused → resume. Needs `npm run demo -- --no-agent` running.
//   npx tsx scripts/record-backup.ts   → docs/demo-backup.webm
import { chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process";
import { renameSync, mkdirSync } from "node:fs";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const dir = "docs/.video-tmp";
mkdirSync(dir, { recursive: true });
const sh = (args: string[]) => spawnSync("npx", ["tsx", ...args], { stdio: "ignore" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

sh(["scripts/reset-demo.ts"]);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } } });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="spent"]');
await wait(3000);

// Agent run (scripted, with natural pauses between steps)
const agent = spawn("npx", ["tsx", "agent/index.ts", "--mode", "scripted"], { stdio: "ignore" });
await page.waitForSelector('[data-testid="rejection-row"]', { timeout: 120_000 });
await new Promise((r) => agent.on("exit", r));
await wait(4000);

// Open the onchain receipt of the blocked 50 USDC payment (program logs show RecipientNotAllowed)
await page.locator('[data-testid="rejection-row"]').first().locator('[data-testid="tx-link"]').click();
await page.waitForFunction(() => document.querySelector('[data-testid="receipt"]')?.textContent?.includes("Error Code"), null, { timeout: 15_000 });
await wait(2000);
await page.screenshot({ path: "docs/screenshots/receipt-rejected.png" });
await wait(5000);
await page.keyboard.press("Escape");
await wait(1500);

// Kill switch
await page.click('[data-testid="kill-switch"]');
await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.toLowerCase().includes("paused"), null, { timeout: 30_000 });
await wait(1500);
sh(["scripts/lib/agent-spend-once.ts"]);
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="rejection-row"]')].some((r) => r.textContent?.includes("PolicyPaused")), null, { timeout: 15_000 });
await wait(4000);
await page.click('[data-testid="kill-switch"]');
await page.waitForFunction(() => document.querySelector('[data-testid="status"]')?.textContent?.toLowerCase().includes("active"), null, { timeout: 30_000 });
await wait(3000);

const video = page.video();
await ctx.close();
await browser.close();
const path = await video!.path();
renameSync(path, "docs/demo-backup.webm");
console.log("saved docs/demo-backup.webm");
