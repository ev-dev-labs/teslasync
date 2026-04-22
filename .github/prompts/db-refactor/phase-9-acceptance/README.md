# Phase 9 — Acceptance Gates (Atomic, One Assertion per Prompt)

> **Goal:** Each merge-ready check is its own prompt (~25 total) so each can be re-run independently and each produces a citable log. Final prompt aggregates all logs into `MERGE_READY.md`.

## Prompts in this phase

### Go build & test (01–05)
| # | File | Gate |
|--:|------|------|
| 01 | `01-go-mod-tidy.prompt.md` | `go mod tidy` clean; go.sum unchanged |
| 02 | `02-go-build-all.prompt.md` | `go build ./...` exit 0 |
| 03 | `03-go-vet-all.prompt.md` | `go vet ./...` clean |
| 04 | `04-go-test-race.prompt.md` | `go test -race -count=1 ./...` green |
| 05 | `05-go-lint-and-vuln.prompt.md` | `golangci-lint` + `govulncheck` clean |

### Frontend build & test (06–09)
| # | File | Gate |
|--:|------|------|
| 06 | `06-frontend-tsc.prompt.md` | `npx tsc --noEmit` |
| 07 | `07-frontend-eslint.prompt.md` | `npm run lint` |
| 08 | `08-frontend-vitest.prompt.md` | `npm test -- --run` |
| 09 | `09-frontend-build.prompt.md` | `npm run build` + dist size vs baseline |

### Schema & migration (10–12)
| # | File | Gate |
|--:|------|------|
| 10 | `10-fresh-migration-applies.prompt.md` | Wipe vol → up → migrations apply clean |
| 11 | `11-zero-jsonb-invariant.prompt.md` | Grep migrations + Go: 0 unexpected jsonb |
| 12 | `12-no-orphan-signals.prompt.md` | Every signal_observations.signal_name in catalog |

### JSONB carveout COMMENTs (13–16)
| # | File | Gate |
|--:|------|------|
| 13 | `13-carveout-comment-embeddings.prompt.md` | `embeddings.vector` ADR-001 comment |
| 14 | `14-carveout-comment-audit-log-detail.prompt.md` | `audit_log.detail` ADR-001 comment |
| 15 | `15-carveout-comment-api-call-logs-payload.prompt.md` | `api_call_logs.{request,response}_payload` |
| 16 | `16-carveout-comment-fleet-telemetry-raw.prompt.md` | Any `raw_payload jsonb` carveout comment |

### Per-hypertable policy audits (17–24)
| # | File | Hypertable |
|--:|------|------------|
| 17 | `17-policies-positions.prompt.md` | `positions` |
| 18 | `18-policies-charging-telemetry.prompt.md` | `charging_telemetry` |
| 19 | `19-policies-climate-snapshots.prompt.md` | `climate_snapshots` |
| 20 | `20-policies-motor-snapshots.prompt.md` | `motor_snapshots` |
| 21 | `21-policies-security-events.prompt.md` | `security_events` |
| 22 | `22-policies-signal-observations.prompt.md` | `signal_observations` |
| 23 | `23-policies-vehicle-meta-snapshots.prompt.md` | `vehicle_meta_snapshots` |
| 24 | `24-policies-api-call-logs.prompt.md` | `api_call_logs` |

### Final sign-off (25)
| # | File | Gate |
|--:|------|------|
| 25 | `25-merge-readiness-summary.prompt.md` | Aggregate logs → `MERGE_READY.md` + draft PR |

## Reference

- Previous structure: 7 bundled prompts (now superseded by 25 atomic ones).
