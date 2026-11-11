# Discovery notes: decisions log

Source: product deck + discovery interview (Nov 2026). Where the PM answered "default", the recommended option was adopted.

## Scope
| # | Decision |
|---|---|
| Q1 | **MVP persona: D2C founder / brand team only.** Agencies and local businesses (coaching centres) move to the roadmap. |
| Q2 | One brand = one workspace with team roles. Data model is org-ready (workspace-scoped) so agencies can be added later. |
| Q3 | Objectives: **retargeting + reactivation** only. Prospecting/acquisition is a "Could". |
| Q4 | All channels behind a `ChannelAdapter`; **mock Media.net adapter** in MVP. Google/Meta are stubs later. |
| Q5 | Paid media only. Owned channels (email/WhatsApp/push) are future vision. |
| Q6 | Data: pixel + Shopify + CSV (SHA-256 hashed in browser), all mocked. Brand is data fiduciary; consent withdrawal removes the person from audiences within 24h. |
| Q7 | INR; daily + lifetime budgets; **prepaid wallet** (Razorpay mock); auto-pause at cap; only Owner/Admin raise caps. |
| Q8 | AI is **suggest-only**, with a "why" panel; every suggestion and decision is audit-logged. |
| Q9 | Auto-action only on hard safety rules (spend cap, wallet empty). Performance alerts suggest only, after a learning period (3 days or 30 conversions). "Near real-time" (~5 min in prod; 5 s polling in the demo). |
| Q10 | NSM: engaged = click; 7-day click / 1-day view, last-touch, deduped by order ID; **10% brand-level holdout**, with lift reported alongside the NSM. |

## How it works
| # | Decision |
|---|---|
| Q11 | 5-step wizard: Goal → Audience → Budget & schedule → Creative → Review. Target setup time under 10 minutes. **Launch blocked below 1,000 reachable people.** |
| Q12 | Budget Suggester v1 = rules + stats. Limits: wallet ÷ days, 2× past max daily, audience saturation at the frequency cap. **Hidden when confidence is low.** |
| Q13 | 5 rule-based personas; recent buyers (30d) excluded from retargeting by default. |
| Q14 | Frequency cap per campaign with persona presets (e.g. 4/day for carts, 2/day for lapsed buyers). |
| Q15 | Native + 300×250 / 728×90 / 320×50; automated policy check (ASCI-style prohibited claims, https, lengths); mocked human review. |
| Q16 | Rollout change: **Frequency Cap + Template Hub moved to Q1**; Ad Studio is a Q4 "Should", alongside A/B Testing. |
| Q17 | A/B: 2 variants, fixed sample size, no peeking, ≤20% test budget, "inconclusive" shown honestly. |
| Q18 | Roles Owner/Admin/Editor/Viewer; Editor launches above ₹50k need approval; append-only audit log kept 2 years. |
| Q19 | MVP targets (estimates): setup under 10 min, errors under 5%, 60% weekly dashboard use, 40% of campaigns use a Smart Persona, 30% suggestion acceptance, 0 overspend incidents, NSM lift ≥ +15% relative. |
| Q20 | Festive calendar presets; separate peak benchmarks; looser alert thresholds during peaks. |

## Stack and operations
| # | Decision |
|---|---|
| Q21 | Next.js App Router + TS + Tailwind + shadcn-style UI; route handlers; Prisma; Redis/BullMQ (later); Recharts; Auth.js (later). |
| Q22 | `LLMProvider` interface for Ad Studio; mock first, Claude via the Anthropic API as first real provider; outputs pass the policy check. |
| Q23 | Retention: raw events 13 months; hashed lists deleted 30 days after disconnect; aggregates 3 years; audit 2 years. |
| Q24 | Onboarding checklist + seeded demo data; email support with a 24-hour target. |
| Q25 | English UI, i18n-ready; ₹ with Indian digit grouping; IST; WCAG 2.1 AA. |
| Q26 | Containers (workers rule out serverless-only); provider-neutral. |

## Gap-analysis decisions (D1–D6, defaults applied)
- **D1** Dynamic product ads: Must, Q3 (built in demo with a mock catalog).
- **D2** Pixel health check: Must, Q1.
- **D3** Retention Playbooks + cloning: Must, Q1.
- **D4** Holdout: brand-level, persistent, 10% default (5% minimum), always on.
- **D5** GST invoices/refunds, offer code field, report export: Should, Q2 (invoices + offer code done; export pending).
- **D6** Hosting: containers.

## Open questions
1. **How does Media.net inventory reach a specific known user?** (hashed email match, first-party pixel ID, or contextual only). This decides whether retargeting on Media.net is feasible. The MVP assumes identity matching (simulated).
2. Internal baselines for the MVP success targets.
3. Review SLA and staffing for festive creative surges.
4. Who signs off on the honest-lift positioning, given that many campaigns will show inconclusive lift?
