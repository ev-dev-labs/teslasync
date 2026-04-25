---
description: "Phase-14 — Frontend unit conversion display"
---
# Prompt 16 — Frontend Unit Conversion (display in user preference)
> **Severity:** Feature | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-16-fe-units.log` |
| Allowed files to change | `web/src/lib/unitConversion.ts`, `web/src/hooks/useSettings.ts`, frontend page files, the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Depends on: Prompt 07 (unit conversion helpers created)

## Context

Backend now stores all values in internal units (miles, °C, PSI). The frontend needs
to convert to the user's display preference (km, °F, bar) at render time.

Check `web/src/hooks/useSettings.ts` — it likely already has `convertDistance`,
`convertTemp`, `convertPressure` helpers. If so, ensure they use the functions from
`web/src/lib/unitConversion.ts` (prompt 07) and are applied consistently.

## Task

### 1. Survey existing conversion usage

```bash
grep -rn "convertDistance\|convertTemp\|convertPressure\|convertSpeed\|useSettings" --include="*.tsx" web/src/features/ | head -30
```

Check if conversions are applied in all pages that display:
- Distance (drives, trips, fleet overview, mileage)
- Temperature (climate, vehicle detail, drive detail)
- Speed (drives, speed profile, vehicle detail)
- Pressure (tire pressure page)

### 2. Ensure all pages use conversion hooks

For each page that displays measurements:
- Verify it calls `useSettings()` to get the user's preference
- Verify it applies `convertDistance()` / `convertTemp()` / `convertPressure()` before display
- Verify it shows the correct unit label (mi/km, °F/°C, PSI/bar)

### 3. Pages to check (at minimum)

- Drive list / detail pages
- Charging list / detail pages
- Fleet overview / vehicle cards
- Speed profile page
- Temperature impact page
- Tire pressure page
- Climate page
- Vehicle detail page (quick stats grid)
- Live Signal Monitor (raw values — these should NOT be converted)

### Constraints

- **Live Signal Monitor** and **Signal Explorer** show raw values — do NOT convert
- If `useSettings` already handles this correctly, this prompt may be STATUS=DONE quickly
- Do not change API response format — conversion is frontend-only
- Unit labels must match the conversion (don't show "km" if displaying miles)

## Gate

```powershell
cd D:\repos\teslasync\web
npx tsc --noEmit
```

Log result. STATUS=DONE only if tsc passes AND survey confirms conversions are applied.



## Commit

After gate passes, commit all changes:
```powershell
cd D:\repos\teslasync
git add -A
git commit -m "phase-14/16-fe-units: <brief description>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Include `phase-14/16-fe-units` as the commit message prefix.

