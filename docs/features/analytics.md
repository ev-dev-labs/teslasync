# Analytics and Charts

Analytics pages turn drive, charging, battery, route, cost, and signal history into operational views.

## Main analytics areas

| Area | Pages and examples |
|---|---|
| Fleet analytics | Analytics, statistics, lifetime stats, weekly digest, year review |
| Cost | Cost analysis, total cost of ownership, Tesla charging history |
| Driving | Drive score, speed profile, driving dynamics, regen efficiency, route efficiency |
| Battery | Battery health, battery cells, degradation, projected range |
| Energy | Energy, energy flow, power flow, energy products, efficiency |
| Environment | Temperature impact, sleep efficiency, vampire drain |
| Diagnostics | Signal explorer, signal log viewer, signal diff, gap detector, anomaly dashboard |

## Chart rules

- Use chart components and Recharts re-exports from `@/components/charts`.
- Always show loading, error, and empty states.
- Convert units with shared unit-conversion utilities.
- Keep API response types aligned with Go JSON tags.

## Backend data

Analytics APIs live under `/api/v1/analytics/*` plus domain endpoints for drives, charging, vehicles, energy, and signals. Database acceleration comes from TimescaleDB/continuous aggregates and indexed historical tables where available.

## Grafana

Grafana is included for operational and SQL-backed dashboards. App pages should not depend on Grafana being public; Grafana can stay internal or protected separately.