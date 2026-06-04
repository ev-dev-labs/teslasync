---
description: "P1/S5-0001 — Port SI unit converters/formatters to the KMP shared core + golden vectors"
---

# P1 · S5-0001 — SI units + formatting (shared core) + golden vectors

> **Severity:** Foundational (every screen formats units) · **Delegation:** FORBIDDEN

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/src/commonMain/.../units/` (converters + formatters) + `apps/shared/spec/units-golden.json` + tests |
| Allowed files | `apps/shared/src/**/units/**`, `apps/shared/spec/units-golden.json`, `apps/shared/src/**/test/**units**`, the log file |
| Depends on | S3 (KMP project setup) |
| Blocks | S8 presentation, every UI prompt that shows a unit; the C# units port (P2) |
| ADR refs | ADR-004 (shared core / golden vectors), ADR-013 |
| Instr refs | `.github/instructions/unit-conversion.instructions.md`, `.github/instructions/frontend-si-cutover.instructions.md` |
| Log | `../logs/p1-s5-0001-si-units.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

Port the web app's **SI-canonical** converters/formatters to Kotlin (shared core), 1:1 with
`web/src/lib/unitConversion.ts` (the non-deprecated SI block, L1–395), AND emit a
language-neutral **golden-vector** fixture so the future C# (Windows) port is provably identical.

## Exact API to port (match web names + semantics)

The backend stores **SI**; convert at the display boundary by user preference. Port these
(from `web/src/lib/unitConversion.ts`):

| Converter (SI → display) | Formatter |
|---|---|
| `convertDistanceFromSI` (m → mi/km) | `formatDistance` |
| `convertSpeedFromSI` (mps → mph/kph) | `formatSpeed` |
| `convertTempFromSI` (°C → °C/°F) | `formatTemperature` |
| `convertPressureFromSI` (Pa → psi/bar/kPa) | `formatPressure` |
| `convertEnergyFromSI` (Wh → kWh) | `formatEnergy` |
| `convertDurationFromSI` (s → human) | `formatDuration` |
| `convertPowerFromSI` (W → kW) | `formatPower` |

Plus the `UnitPreference`/`SI` types governing which display unit is chosen. **Do NOT** port the
`@deprecated` legacy converter block (L397+) — it is being deleted (Phase-48); reimplementing
it is forbidden (rule: no field/util resurrection).

## Golden vectors — `apps/shared/spec/units-golden.json`

Language-neutral fixture: array of `{ fn, input_si, preference, expected_value, expected_formatted }`.
Generate it by running the **web** converters over a fixed input grid (so KMP and C# must both
match the *web* truth). Include edge cases: zero, negative (regen power), null/absent, very large,
rounding boundaries, both metric + imperial preferences for every fn.

## Tests

- Kotlin unit tests load `units-golden.json` and assert every row matches (value + formatted).
- A cross-check test asserts every ported fn has ≥1 metric and ≥1 imperial golden row.

## Gate

```powershell
./gradlew :shared:test --tests "*Units*" 2>&1 | Tee-Object $log -Append
"EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# golden file parses + covers all 7 fns
$g = Get-Content apps/shared/spec/units-golden.json -Raw | ConvertFrom-Json
$fns = ($g.fn | Select-Object -Unique)
"GOLDEN_FNS=$($fns -join ',')" | Tee-Object $log -Append
if ($fns.Count -lt 7) { "[FAIL] golden missing fns" | Tee-Object $log -Append; "EXIT=1" | Tee-Object $log -Append }
```

## Acceptance Criteria

- [ ] All 7 converters + 7 formatters ported, names/semantics matching the web SI block.
- [ ] `units-golden.json` derived from the web converters; covers edge cases + both unit systems.
- [ ] Kotlin tests pass against the golden vectors.
- [ ] Deprecated legacy converters NOT ported.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope (reject)

- No UI. No C# yet (P2 ports against the same golden file).
- No new unit types beyond the web's set.

## Commit

```powershell
git add apps/shared/src apps/shared/spec/units-golden.json .github/prompts/monorepo/logs/p1-s5-0001-si-units.log
git commit -m "feat(apps/shared): SI unit converters/formatters + golden vectors (P1/S5-0001)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
