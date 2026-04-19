---
description: "Signal audit synthesis: aggregate all signal reports into master traceability matrix"
---

# Signal Audit Synthesis — Master Traceability Matrix

## Objective

Aggregate all individual signal audit reports from the `signal-audit/` sub-folders
into a single comprehensive traceability matrix. This is the **single source of truth**
for Tesla Fleet Telemetry signal mapping integrity in TeslaSync.

## Input

Load all completed audit reports from:
```
.github/prompts/features/signal-audit/01-charging-numeric/
.github/prompts/features/signal-audit/02-charging-enums/
.github/prompts/features/signal-audit/03-powershare/
.github/prompts/features/signal-audit/04-climate/
.github/prompts/features/signal-audit/05-driving/
.github/prompts/features/signal-audit/06-powertrain/
.github/prompts/features/signal-audit/07-location/
.github/prompts/features/signal-audit/08-media/
.github/prompts/features/signal-audit/09-safety/
.github/prompts/features/signal-audit/10-tpms/
.github/prompts/features/signal-audit/11-vehicle-state/
.github/prompts/features/signal-audit/12-vehicle-config/
.github/prompts/features/signal-audit/13-user-preferences/
```

## Output Format

Generate a markdown file `SIGNAL_TRACEABILITY_MATRIX.md` in the repository root
with the following structure:

### Summary Statistics

| Metric | Count |
|--------|-------|
| Total Signals Audited | ___ |
| 🟢 Match (correct end-to-end) | ___ |
| 🟡 Rounding Difference | ___ |
| 🔴 Critical Mismatch | ___ |
| ⚪ Orphaned (ingested, not displayed) | ___ |
| Fixes Required | ___ |

### Category Breakdown

| Category | Signals | 🟢 | 🟡 | 🔴 | ⚪ |
|----------|---------|-----|-----|-----|-----|
| Charging (numeric) | 41 | | | | |
| Charging (enums) | 11 | | | | |
| Powershare | 5 | | | | |
| Climate | 29 | | | | |
| Driving | 12 | | | | |
| Powertrain | 36 | | | | |
| Location | 13 | | | | |
| Media | 11 | | | | |
| Safety | 14 | | | | |
| TPMS | 10 | | | | |
| Vehicle State | 29 | | | | |
| Vehicle Config | 14 | | | | |
| User Preferences | 5 | | | | |

### Master Traceability Matrix

| # | Tesla Signal | Type | Coercion | DB Table | DB Column | DB Type | API Endpoint | JSON Field | Frontend Hook | TS Field | UI Page(s) | Display Format | Parity |
|---|-------------|------|----------|----------|-----------|---------|-------------|-----------|--------------|---------|-----------|---------------|--------|
| 1 | ACChargingEnergyIn | Float | direct | vehicle_live_state | ac_charging_energy_in | FLOAT8 | /vehicles/{id}/state | ac_charging_energy_in | useVehicles | acChargingEnergyIn | ChargingDetailPage | {value} kWh | 🟢 |
| 2 | ... | | | | | | | | | | | | |

### Critical Mismatches (Action Required)

For each 🔴 signal, list:
- Signal name
- What's wrong
- Root cause
- Suggested fix
- Files to change

### Orphaned Signals

For each ⚪ signal, list:
- Signal name
- Where it's ingested
- Why it's not displayed (missing UI, missing API endpoint, etc.)
- Recommendation: add UI display, or remove from subscription

## Commit

```bash
git add SIGNAL_TRACEABILITY_MATRIX.md
git commit -m "docs: add Tesla signal traceability matrix — 230 signals audited

Complete end-to-end audit of all 230 Tesla Fleet Telemetry signals.
Traces each signal from raw ingestion → DB storage → API response → UI display.
Documents X mismatches, Y orphaned signals, and Z fixes required."
```
