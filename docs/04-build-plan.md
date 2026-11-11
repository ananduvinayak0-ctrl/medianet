# Build plan

The MVP demo is built (see README). Remaining tickets are ordered by the rollout. Each one is small enough to finish and test in one sitting.

## Done (demo MVP)
- T-01 Project scaffold, Prisma schema, seed with consistent simulated history
- T-02 Domain libs: money/IST, holdout hashing, benchmarks, festive calendar, RBAC, policy check
- T-03 Mock channel: delivery engine (pacing, daily/lifetime/wallet caps, frequency cap, fatigue, holdout outcomes) + runner with optimistic clock lock
- T-04 Campaign service: create/draft/launch/approve/pause/resume/stop/clone/budget, idempotency, audit
- T-05 Budget Suggester v1 + "why" panel, suggestion lifecycle logging
- T-06 Wizard (5 steps), playbooks, dynamic product preview
- T-07 Live Monitor, alerts (hard-rule auto-actions vs suggest-only), learning-period guard
- T-08 Dashboard, lift card, NSM, campaign history filters
- T-09 Smart Personas, Template Hub, Pixel health, Wallet, Audit log pages
- T-10 Unit tests for engine, suggester, stats, policy, RBAC, calendar (25 tests)
- T-19 A/B Testing: creative A vs B on CTR; `AbTest` model; pre-launch power calc (80% power, 5% significance, chosen MDE); test capped at 20% of lifetime budget; fixed horizon with interim results withheld server-side; A wins / B wins / inconclusive; suggest-only "switch to B"; `/ab-tests` page; 16 unit tests (power calc, decision rule, A/A false-positive rate vs peeking, simulator split). Audience tests deferred: two personas are different populations, not a randomised split.

## Next

| Ticket | Scope | Files | Acceptance criteria | Tests |
|---|---|---|---|---|
| T-11 Postgres + Docker Compose | Switch provider, add `docker-compose.yml` (Postgres 16, Redis 7), migrations instead of `db push` | `prisma/schema.prisma`, `docker-compose.yml`, `package.json` | `docker compose up` + `prisma migrate dev` + seed works; all pages load | Existing suite against Postgres |
| T-12 Auth.js | Email magic link + Google SSO; replace demo role cookie with real memberships | `src/lib/session.ts`, `src/app/api/auth/*`, `src/app/login` | Unauthenticated users are redirected; roles come from Membership | Route guard tests |
| T-13 Worker process | BullMQ worker runs `runSimulation`/sync every 1 min; request path stops advancing the clock; heartbeat + "data delayed" banner when > 30 min stale; AI suggestions frozen while stale | `src/worker/*`, `src/lib/sim/runner.ts` | Delivery continues with no traffic; stale banner appears when the worker is stopped | Integration test with a fake clock |
| T-14 Reconciliation | Every 5 min compare our status with the adapter's; alert on mismatch; outbox table for adapter commands | `src/lib/channels/*`, schema `AdapterCommand` | Injected mismatch raises `adapter_error` alert | Unit + `MOCK_ADAPTER_FAILURE_RATE=0.3` run |
| T-15 CSV customer list upload | Browser-side SHA-256, consent declaration, list expiry (30 days after delete) | `src/app/audiences/upload`, `src/lib/hash.ts` | No raw email reaches the server (verified in network log) | Unit tests for normalise + hash |
| T-16 Report export (D5) | CSV + printable report per campaign / date range | `src/app/api/reports/*` | Totals match dashboard to the rupee | Snapshot test |
| T-17 Refunds | Wallet withdrawal request flow (Owner), ledger `refund` entries | wallet service, page | Balance never negative; audit entry | Unit |
| T-18 Budget Suggester backtest | Replay completed campaigns; compare rules vs "same as last time" | `scripts/backtest.ts` | Report of error vs baseline | — |
| T-20 Ad Studio (Q4) | `LLMProvider` interface + mock; Claude provider; policy check on every output | `src/lib/ai/ad-studio/*` | No PII in prompts; all outputs policy-checked | Prompt-redaction tests |
| T-21 Real integrations | Media.net adapter, Shopify app sync, Razorpay webhooks | `src/lib/channels/medianet.ts`, etc. | Behind feature flags; mock remains default | Contract tests |

## Environment variables
| Var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Prisma connection | `file:./dev.db` |
| `SIM_SPEED` | Demo clock speed (simulated s per real s) | `120` |
| `CHANNEL_ADAPTER` | Adapter selection | `mock` |
| `MOCK_ADAPTER_FAILURE_RATE` | Inject adapter failures (0–1) | `0` |
