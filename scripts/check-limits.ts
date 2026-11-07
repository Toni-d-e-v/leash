// Limits E2E: in the dashboard, lower the per-transaction cap below market-data's price (0.05) →
// the agent's next spend fails onchain with OverPerTxCap → raise it back → spends work again.
// Also checks that the form refuses a per-tx cap above the daily cap. Needs `npm run demo` running.
import { chromium, type Page } from "playwright";
import { spawnSync } from "node:child_process";
import { ROOT } from "../shared/config.js";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const fail = (m: string) => { console.error(`FAIL: ${m}`); process.exit(1); };
const agent = () =>
  JSON.parse(spawnSync("npx", ["tsx", "scripts/lib/agent-spend-once.ts", "Fresh SOL market data for the brief."], { cwd: ROOT, encoding: "utf8" }).stdout.trim().split("\n").at(-1)!);

async function setLimits(page: Page, perTx: string, daily: string, approval: string, shot?: string) {
  await page.click('[data-testid="edit-limits"]');
  await page.fill('[data-testid="limit-perTx"]', perTx);
  await page.fill('[data-testid="limit-daily"]', daily);
  await page.fill('[data-testid="limit-approval"]', approval);
  if (shot) await page.locator('[data-testid="limits"]').screenshot({ path: shot });
  await page.click('[data-testid="save-limits"]');
  await page.waitForFunction((v) => document.querySelector('[data-testid="limits"]')?.textContent?.includes(`${v} USDC`), Number(perTx).toFixed(2), { timeout: 30_000 });
  console.log(`limits saved onchain: ${perTx}/tx · ${daily}/day · approval ${approval}`);
}

spawnSync("npx", ["tsx", "scripts/reset-demo.ts"], { cwd: ROOT, stdio: "ignore" });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors: string[] = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector('[data-testid="edit-limits"]');

// The form refuses impossible limits before anything is sent.
await page.click('[data-testid="edit-limits"]');
await page.fill('[data-testid="limit-perTx"]', "2");
if (!(await page.isDisabled('[data-testid="save-limits"]'))) fail("save should be disabled when per-tx cap > daily cap");
console.log("form: per-tx 2 > daily 1 → Save disabled");
await page.click("text=Cancel");

await setLimits(page, "0.04", "1", "0.15", "docs/screenshots/limits-edit.png");
const blocked = agent();
console.log(`agent spend of 0.05 → ${JSON.stringify(blocked)}`);
if (blocked.ok || !String(blocked.error).includes("OverPerTxCap")) fail("expected OverPerTxCap");
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="rejection-row"]')].some((r) => r.textContent?.includes("OverPerTxCap")), null, { timeout: 15_000 });
console.log("dashboard shows red OverPerTxCap row");

await setLimits(page, "0.2", "1", "0.15");
const ok = agent();
console.log(`agent spend of 0.05 → ${JSON.stringify(ok)}`);
if (!ok.ok) fail("expected spend to succeed after raising the cap");
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/screenshots/dashboard-limits.png" });
await browser.close();
if (errors.length) fail(`console errors: ${errors.join(" | ")}`);
console.log("PASS");
