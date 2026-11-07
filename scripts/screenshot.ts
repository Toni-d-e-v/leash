// Dashboard screenshots at desktop and mobile widths; fails on console errors.
//   npx tsx scripts/screenshot.ts [outDir] [--wait-for-rejection]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const out = process.argv.find((a, i) => i > 1 && !a.startsWith("--")) ?? "docs/screenshots";
const waitRejection = process.argv.includes("--wait-for-rejection");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors: string[] = [];
for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]] as const) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: name === "mobile" ? 2 : 1 });
  page.on("console", (m) => { if (m.type() === "error") errors.push(`[${name}] ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="spent"]', { timeout: 20_000 });
  if (waitRejection) await page.waitForSelector('[data-testid="rejection-row"]', { timeout: 120_000 });
  await page.waitForTimeout(2500); // let hash verification settle
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) errors.push(`[${name}] horizontal overflow ${overflow}px`);
  await page.screenshot({ path: `${out}/dashboard-${name}.png`, fullPage: true });
  console.log(`saved ${out}/dashboard-${name}.png`);
  await page.close();
}
await browser.close();
if (errors.length) { console.log("Console errors:\n" + errors.join("\n")); process.exit(1); }
console.log("No console errors.");
