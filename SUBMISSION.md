# Devpost submission — Leash

**Project name:** Leash

**Tagline:** Give your AI agent a wallet without giving it your money. Spending limits enforced by a Solana program.

**Tracks:** AI Track (Top 3 overall is automatic)

---

## Inspiration
Agents are starting to pay for things on their own: APIs, data, compute. The options today are bad: hand the agent a credit card, or a hot wallet with everything in it. Prompt injection is real and unsolved, so either one is a single malicious web page away from being drained. We wanted guardrails the model can't talk its way around.

## What it does
Leash is a Solana program that holds USDC in a vault and lets an AI agent spend it only within rules the program enforces: a per-transaction cap, a rolling 24h budget, a recipient allowlist, an expiry and a kill switch. The agent holds a session key that can only call `spend`. Payments above an approval threshold become a pending request onchain that the owner approves or rejects from the dashboard. The owner can pause, rotate the agent key, change limits or withdraw at any time.

In the demo, a research agent pays per request for market data and summarization via x402-style `402 Payment Required` APIs. Each payment shows up live on a dashboard with the agent's stated reason and a "hash verified onchain" badge. Then a third API's response carries a prompt injection telling the agent to send 50 USDC to an attacker. The agent tries, and the transaction fails onchain with `RecipientNotAllowed`. Zero USDC moves. One click on the kill switch and every further spend fails with `PolicyPaused`.

## How we built it
- **Program (Rust, Anchor 0.31):** a `Policy` PDA plus a vault ATA owned by the PDA. `spend` checks the rules in a fixed order with a distinct error for each, then calls `transfer_checked` (Token interface, so Token-2022 works too) with PDA signer seeds and emits a `SpendEvent` with `request_id` and `reason_hash`. Checked math throughout, allowlist capped at 8.
- **Human approval:** above `approval_threshold`, the agent calls `request_spend` (same rule checks, creates a `PendingSpend` PDA). The owner's `approve_spend` re-checks the rules, pays and emits the `SpendEvent`; the x402 facilitator then accepts that settled signature as payment for the original request.
- **Tests:** 18 tests on LiteSVM, including warping the clock for the 24h window reset, every error path, key rotation, pause-but-withdraw, close and the approval flow.
- **Paid APIs (Express):** x402 v2 on the wire (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`), with a nonce per request that the agent must put into `spend`'s `request_id`. A Leash facilitator implements `/verify` (static checks + simulation + SpendEvent match) and `/settle` (submit, confirm, re-check the onchain event, replay protection).
- **Agent (TypeScript):** Claude with tool use (`list_services`, `call_service`, `pay`, `check_budget`), plus a deterministic scripted mode so the demo never depends on model behaviour. Before every payment the agent states a one-sentence reason; `sha256(reason)` goes onchain and the full text goes to the dashboard.
- **Dashboard (Next.js, Tailwind, wallet adapter):** live budget meter via `onAccountChange` (polling fallback), an SSE activity feed, client-side re-hashing of every reason against the onchain event, and a big kill switch.

## Challenges we ran into
- **x402 facilitators don't accept custom-program payments.** We sent a spec-shaped Leash payment to the public x402.org facilitator. It was rejected with `invalid_exact_svm_smart_wallet_program_not_allowed`, because the SVM `exact` scheme only allows plain transfers or allowlisted smart wallets. We kept x402 v2 on the wire and built our own facilitator with the same interface.
- **Getting the check order exactly right.** Anchor's `has_one` constraints run before the handler, which would have reported `UnauthorizedAgent` before `PolicyPaused`. All rule checks moved into the handler so each failure maps to one clear error.
- **Toolchain friction:** prebuilt binaries needing a newer glibc meant using a source-built Anchor CLI and an older LiteSVM build. Devnet faucets were rate-limited all day, so everything is cluster-configurable and runs on a local validator by default.
- **A non-allowlisted service can't be paid, so how does its injection reach the agent?** Through a free preview in the 402 response, which is exactly how a real "teaser" API would do it.

## Accomplishments that we're proud of
- The money shot works every time: injected payment → onchain `RecipientNotAllowed`, with a failed transaction you can open in the explorer.
- A verifiable audit trail of *why* the AI spent money: anyone can re-hash the reason and compare it with the onchain event.
- One command (`npm run demo`) brings up the validator, policy, APIs, dashboard and agent from a clean state.

## What we learned
The safest place for agent guardrails is somewhere the agent has no say. Prompts and backends can be argued with; a program's `require!` can't. Solana's fees and confirmation times make per-request payments practical, so you can put every payment through those checks.

## What's next for Leash
- Push notifications so pending approvals reach the owner's phone
- An `@leash/agent` SDK so any agent framework can plug in
- Standard x402 `exact` compatibility via facilitator smart-wallet allowlists
- Mainnet USDC, per-service budgets, spend analytics

## Built with
solana, anchor, rust, typescript, node.js, express, x402, claude, anthropic-api, next.js, react, tailwindcss, solana-wallet-adapter, litesvm, playwright

## Honest notes for judges
The APIs return mock market data. Test USDC is a 6-decimal mint we created. The demo runs on a local validator (devnet deploy is scripted). x402 settlement goes through our own facilitator. Scripted mode follows the injection on purpose, so the onchain block is always visible; in LLM mode the run logs whether Claude followed it.
