# Phase 13 — Anti-Pattern Cleanup: Centralize Constants, Eliminate Duplication

## Goal

Deep audit found 18+ anti-patterns across frontend and backend — hardcoded
domain constants, duplicate functions, scattered column names, magic numbers,
and duplicate types. This phase centralizes everything into single sources of
truth so future schema/signal changes require touching ONE file, not 30.

## Findings Summary

### Frontend (React/TypeScript)
| Issue | Severity | Files |
|-------|----------|-------|
| Duplicate `DAYS`/`MONTHS`/`TIMEZONES` arrays | HIGH | 4 |
| Duplicate `toLocalDatetime()` / `formatValue()` | HIGH | 3 |
| Duplicate `SignalRow` / `SignalHistoryResp` interfaces | MEDIUM | 2 |
| Duplicate `PRESETS` time-range arrays | HIGH | 2 |
| Hardcoded `STATE_CHECK_FIELDS` signal names | MEDIUM | 1 |
| Inline hex colors duplicating `CHART_COLORS` | MEDIUM | 3 |
| `BadgeVariant` type redeclared locally | LOW | 1 |
| Magic `staleTime`/`refetchInterval` numbers | HIGH | 30+ |

### Backend (Go)
| Issue | Severity | Files |
|-------|----------|-------|
| Duplicate `toFloat64`/`safeFloat`/`parseInt64` helpers | HIGH | 6+ |
| Signal→column mapping scattered (not just `signalToColumn`) | HIGH | 5+ |
| Hardcoded column names in SQL across handlers | HIGH | 8+ |
| Magic timeout/interval numbers | MEDIUM | 5+ |
| Enum state strings as literals (`"parked"`, `"charging"`) | MEDIUM | 5+ |
| Hardcoded query column lists | MEDIUM | 4+ |
| Duplicate SQL query patterns | MEDIUM | 10+ |

## Prompt ordering (10 atomic prompts)

```
── Frontend ──
00 — Centralize domain constants (DAYS, MONTHS, TIMEZONES, OPERATORS, PRESETS)
01 — Centralize timing intervals (staleTime, refetchInterval, setTimeout)
02 — Deduplicate utility functions (toLocalDatetime, formatValue, batteryColor)
03 — Deduplicate types + interfaces (SignalRow, SignalHistoryResp, BadgeVariant)
04 — Centralize signal field catalog (STATE_CHECK_FIELDS → shared registry)

── Backend ──
05 — Centralize Go helper functions (toFloat64, safeFloat, parseInt64, formatFloat)
06 — Create signal catalog (signalToColumn + column type metadata in one place)
07 — Centralize Go timeouts/intervals into config constants
08 — Standardize enum state strings (use enums package everywhere)

── Gate ──
09 — Gate: tsc + go build + grep verification (zero local const/type duplicates)
```

## Design principles
- One constant, one place — imports everywhere
- Backend: `internal/database/signal_catalog.go` for signal→column mappings
- Backend: `internal/api/converters.go` for shared type conversion helpers
- Backend: `internal/config/timings.go` for all timeout/interval constants
- Frontend: `@/lib/constants.ts` for DAYS, MONTHS, TIMEZONES, INTERVALS
- Frontend: `@/lib/signals.ts` for signal field definitions
- Each prompt has a grep gate to verify zero duplicates remain
