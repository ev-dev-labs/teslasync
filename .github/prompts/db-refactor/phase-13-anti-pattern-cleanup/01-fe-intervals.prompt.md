---
description: "Phase-13 — Centralize frontend timing intervals"
---
# Prompt 01 — Centralize Timing Intervals (staleTime, refetchInterval, setTimeout)
> **Severity:** HIGH | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-13-01-fe-intervals.log` |
| Allowed files to change | `web/src/lib/constants.ts`, all `web/src/api/hooks/*.ts` files, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 00 (constants.ts exists)

## Problem

30+ files have magic numbers for `staleTime`, `refetchInterval`, and `setTimeout`.
Inconsistent formatting (`15000` vs `15_000` vs `15 * 1000`). No central config.

## Task

### 1. Add INTERVALS section to `web/src/lib/constants.ts`

```typescript
/** Centralized timing intervals (milliseconds) */
export const INTERVALS = {
  /** 5s — real-time data (SSE, live state) */
  REALTIME: 5_000,
  /** 10s — frequently changing data (vehicle state, positions) */
  FAST: 10_000,
  /** 30s — moderately changing data (drives list, charges) */
  STANDARD: 30_000,
  /** 60s — slow-changing data (settings, geofences) */
  SLOW: 60_000,
  /** 5 min — rarely changing data (analytics, statistics) */
  ANALYTICS: 5 * 60_000,
  /** 1 hour — near-static data (vehicle list, fleet overview) */
  RARE: 60 * 60_000,
  /** Never refetch automatically */
  STATIC: Infinity,
} as const

export const STALE_TIMES = {
  REALTIME: 5_000,
  FAST: 30_000,
  STANDARD: 60_000,
  SLOW: 5 * 60_000,
  ANALYTICS: 15 * 60_000,
  RARE: 60 * 60_000,
  STATIC: Infinity,
} as const
```

### 2. Replace magic numbers in `web/src/api/hooks/*.ts`

Survey all hook files. Replace bare numbers with the appropriate constant:

```typescript
// Before:
staleTime: 30_000,
refetchInterval: 10_000,

// After:
staleTime: STALE_TIMES.FAST,
refetchInterval: INTERVALS.FAST,
```

### Important constraints

- **Do NOT change timing values** — only replace literals with named constants
- If a specific interval doesn't fit any category, keep it as-is with a comment
- `setTimeout` calls in UI components (50ms focus delay, 100ms map resize) are fine as-is — only replace polling/caching intervals
- Use underscore notation for any remaining bare numbers (e.g. `1500` → `1_500`)

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
# Count bare staleTime/refetchInterval numbers remaining
grep -rn "staleTime: [0-9]\|refetchInterval: [0-9]" --include="*.ts" --include="*.tsx" src/api/ | wc -l
# Should be 0 (all replaced with INTERVALS.* or STALE_TIMES.*)
```

Log result. STATUS=DONE only if tsc passes AND zero bare timing numbers in api/hooks.
