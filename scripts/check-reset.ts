// Dashboard follows `npm run reset-demo` without a reload (needs the demo running).
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const b = await chromium.launch();
const p = await b.newPage();
const errs: string[] = [];
p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto(process.env.DASHBOARD_URL ?? "http://localhost:3000", { waitUntil: "networkidle" });
await p.waitForSelector('[data-testid="spent"]');
console.log("before:", await p.textContent('[data-testid="spent"]'), (await p.$$('[data-testid="spend-row"]')).length, "spend rows");
execSync("npx tsx scripts/reset-demo.ts", { cwd: process.cwd(), stdio: "ignore" });
await p.waitForFunction(
  () => document.querySelector('[data-testid="spent"]')?.textContent === "0.00" && !document.querySelector('[data-testid="spend-row"]'),
  null, { timeout: 15_000 },
);
console.log("after reset:", await p.textContent('[data-testid="spent"]'), (await p.$$('[data-testid="spend-row"]')).length, "spend rows; console errors:", errs.length);
await b.close();
if (errs.length) process.exit(1);
