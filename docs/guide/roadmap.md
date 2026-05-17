# Roadmap

This page describes where TeslaSync is investing engineering attention, not which features ship on which dates. We deliberately avoid version-pinned timelines because the priorities of a self-hosted project shift with what users actually run into; promising specific milestones for a specific release would be honest only by coincidence.

## What's stable today

These are the foundations new work builds on, not aspirational items. If you install TeslaSync today, all of this is present:

| Surface              | Status                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Backend              | Go 1.25, Chi router, pgx, zerolog, OpenTelemetry, Prometheus, gobreaker resilience                    |
| Workers              | Four worker binaries — notifications, exports, automations, plus the API's in-process scheduler       |
| Frontend             | React 18, Vite 5, TanStack Query 5, Tailwind 3, lazy routes, command palette, 21 feature areas        |
| Helix AI             | 54 user features + 3 ops features, decorator chain trace→audit→cost→ratelimit→redact, off-by-default  |
| Providers            | Ollama (local), OpenAI, Azure OpenAI / Foundry, Anthropic, plus a dev-only mock                        |
| RAG                  | pgvector embeddings, idempotent docs indexer, citation-aware retrieval                                 |
| Telemetry            | Fleet Telemetry server + MQTT bridge + polling fallback, L1 / L2 / durable contract                   |
| Commands             | 65 unique Tesla Fleet API endpoints across 17 categories, with Vehicle Command Proxy routing          |
| Storage              | PostgreSQL 17 + TimescaleDB + pgvector, 197 numbered migrations, hypertables + continuous aggregates  |
| Cache                | Redis L2 + Pub/Sub fanout, per-vehicle signal HSETs                                                   |
| Auth                 | Forward-auth header (Authentik, Authelia, oauth2-proxy, custom), TOTP, encrypted Tesla tokens         |
| Notifications        | Email, SMS, push, webhook, Slack, Discord, Telegram, Matrix                                            |
| Exports              | Async worker, CSV / JSON / Parquet, with PII redaction surfaces                                       |
| Deployment           | Docker Compose (13 services + 4 profiles), Helm chart                                                  |
| Observability        | Prometheus metrics, OpenTelemetry traces (Jaeger optional), Grafana dashboards provisioned at boot    |
| Internationalisation | English baseline with locale fallback, units / dates / currency through context hooks                  |
| Docs                 | VitePress site, in-app printable pages, RAG-fed help chatbot                                          |

## How we decide what to work on next

In rough priority order:

1. **Correctness** — anything the platform reports incorrectly (wrong unit, wrong charge state, drift between live and historical) is treated as a top-priority bug. We'd rather ship fewer features than ship features on top of a value the user can't trust.
2. **Telemetry health** — the data pipeline is the foundation. Improvements to stale-stream detection, signal coverage audits, and recovery semantics get priority over new chrome.
3. **Operability** — backup tested, restores rehearsed, safe defaults in Helm, clearer ingress patterns. A platform that's hard to operate ages badly.
4. **Helix breadth and depth** — more strategies, better tool coverage, more providers, per-feature model overrides, better narration quality. The AI layer is young; we expect this to be where most of the visible product work happens.
5. **Frontend consistency** — the design system is mature but new pages still occasionally bypass it; the audit skill catches that and the team rounds off the edges.
6. **New features** — last in the list deliberately. New surfaces add code to maintain forever; we add them when the user value is clear and the operational cost is well understood.

## Active focus areas

These are the areas getting the most engineering attention right now. None are committed releases; they're directions.

| Area                            | What "doing better" looks like                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Telemetry reliability           | Faster stale-stream detection, automatic resubscribe, better backpressure handling                   |
| Signal coverage                 | Closing gaps where Fleet Telemetry sends a signal but our normaliser doesn't surface it             |
| Helix AI breadth                | Adding strategies for use cases users keep manually scripting (cost outlier explanation, route comparisons, predictive maintenance) |
| Helix AI cost guardrails        | Finer-grained per-feature budgets, surfaced spend forecast, anomaly alerts on AI spend               |
| Helix RAG quality               | Richer corpus, better chunking, citation surfaces in the chatbot UI                                  |
| Frontend consistency            | Continuing the audit-skill work, removing remaining direct chart/map imports, tightening the design system |
| Mobile experience               | Better responsive behaviour on the heaviest pages, smoother PWA install on Android                   |
| Backup / restore                | Automated restore drills as part of CI, smaller and faster in-app backup format                      |
| Documentation                   | Keeping the published docs in lockstep with code reality (where you are right now)                   |
| Observability                   | More dashboards backed by continuous aggregates, business-SLO definitions, fewer noisy alerts        |

## Things we've considered and chose not to do

These are intentional non-goals. We periodically revisit them but currently see no reason to invest:

- **Cloud-hosted SaaS.** TeslaSync is self-hosted by design. A managed SaaS would change the privacy story, the deployment story, and the support model; none of those changes serve the existing audience.
- **Mobile native apps.** The PWA install delivers most of the value of a native app at a fraction of the maintenance cost.
- **Plugin / extension marketplace.** The platform is open source; forks and patches are the existing extension mechanism.
- **Server-side PDF rendering.** Browser print covers the use case; a headless-Chrome service would be infrastructure for an already-solved problem.
- **A separate "AI tier" priced per feature.** Helix is a layer, not a SKU. It's gated by per-feature toggles and cost guardrails, not by paywall.

## Things we don't know yet

Honest "we haven't decided":

- The right ergonomic for cross-vehicle automation rules (today they're per-vehicle with manual duplication)
- Whether the alert rule editor should evolve into a low-code workflow or stay focused on its current shape
- The right boundary between Grafana and the in-app analytics — currently we ship both, with the in-app version handling product-grade UX and Grafana handling power-user ad-hoc queries

If you have opinions on any of these, the [contributing guides](/contributing/code-structure) describe how to propose changes.

## How to contribute

- Bug reports — the more reproducible the better; logs and a request ID help a lot
- Documentation gaps — open a PR; docs changes are first-class
- Feature ideas — open an issue describing the user problem before the proposed solution
- Code — follow the [vertical-slice template](/contributing/adding-features); CI enforces the boundaries

## Related

- [Helix AI](/guide/helix-ai) — the AI layer most active areas centre on
- [Code Structure](/contributing/code-structure) — how the codebase is organised
- [Adding Features](/contributing/adding-features) — the workflow for landing a contribution
