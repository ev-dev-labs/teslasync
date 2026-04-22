# Phase 8 — Helm + Docker (TimescaleDB-HA Cutover)

> **Goal:** Switch local dev (docker-compose) and Helm chart to `timescale/timescaledb-ha:pg17` (per ADR-007). Add an init script that ensures `timescaledb`, `vector`, `pg_stat_statements` extensions are created on a fresh volume.
>
> **Pre-req:** Phases 4, 5, 6, 7 complete.

## Prompts in this phase

| # | File | Purpose |
|--:|------|---------|
| 01 | `01-update-docker-compose.prompt.md` | Switch image, fix PGDATA path, mount init SQL, document fresh-volume requirement |
| 02 | `02-update-helm-chart.prompt.md` | values.yaml + postgres-deployment template + initContainers / initdb scripts |
| 03 | `03-validate-fresh-deploy.prompt.md` | Wipe volumes + bring up + verify migration 142 applies + verify CAGGs run |

## Reference

- ADR-007 (timescale/timescaledb-ha:pg17 engine choice)
- Old monolith: `prompts/06-update-helm-and-deploy.prompt.md` (superseded)
