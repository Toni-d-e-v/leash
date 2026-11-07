// "Run agent" button E2E: fresh policy → the empty feed offers "Run the agent" → click → the full
// scenario plays out in the dashboard (2 paid, 2 blocked onchain, final brief). Needs `npm run demo -- --no-agent`.
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import { ROOT } from "../shared/config.js";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };

spawnSync("npx", ["tsx", "scripts/reset-demo.ts"], { cwd: ROOT, stdio: "ignore" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="run-agent"]');
await page.screenshot({ path: "docs/screenshots/dashboard-empty.png" });
console.log("empty feed shows: Run the agent");

await page.click('[data-testid="run-agent"]');
console.log("click: Run the agent");
await page.waitForFunction(() => document.querySelector('[data-testid="run-agent"]')?.textContent?.includes("running"), null, { timeout: 10_000 });
console.log("button: Agent running…");
await page.waitForFunction(
  () => document.querySelectorAll('[data-testid="spend-row"]').length >= 2 && document.querySelectorAll('[data-testid="rejection-row"]').length >= 2
    && document.body.textContent?.includes("brief"),
  null, { timeout: 120_000 },
);
const rejections = await page.$$eval('[data-testid="rejection-row"]', (rows) => rows.map((r) => r.textContent ?? ""));
if (!rejections.every((r) => r.includes("RecipientNotAllowed"))) fail(`unexpected rejections: ${rejections.join(" | ")}`);
console.log(`feed: 2 paid, ${rejections.length} blocked (RecipientNotAllowed), final brief`);
await page.waitForFunction(() => !document.querySelector('[data-testid="run-agent"]')?.textContent?.includes("running"), null, { timeout: 30_000 });
console.log("button back to: Run agent");
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/screenshots/dashboard-desktop.png" });
await browser.close();
if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("PASS");
