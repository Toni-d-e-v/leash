// Create and fund the demo policy (0.20/tx, 1.00/day, 2 allowlisted APIs, 24h expiry, 5 USDC).
import { createDemoPolicy } from "./lib/policy.js";
createDemoPolicy().catch((e) => { console.error(e.message ?? e); process.exit(1); });
