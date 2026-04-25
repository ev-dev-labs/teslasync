---
description: "Phase-14 — Unit conversion helpers (Go + frontend)"
---
# Prompt 07 — Unit Conversion Helpers
> **Severity:** Core | **Atomic:** yes | **Delegation:** FORBIDDEN

| Field | Value |
|---|---|
| Output log | `.github/prompts/db-refactor/logs/phase-14-07-units.log` |
| Allowed files to change | `internal/units/convert.go` (CREATE), `web/src/lib/unitConversion.ts` (CREATE or extend), the log file |

## Honesty Covenant
<!-- BEGIN COVENANT -->
1. No red-as-green. 2. No scope narrowing. 3. No skip-and-assume. 4. No field resurrection. 5. No stubs. 6. No delegation (NO sub-agents, NO parallel, NO background). 7. No predecessor bypass. 8. No commit on red. 9. No silent drift. 10. Log MUST contain EXIT=<int> and STATUS=<DONE|BLOCKED>.
<!-- END COVENANT -->
## Logging: === SURVEY ===, === REASONING ===, === CHANGES ===, === GATE ===, === COMMIT ===.
## CRITICAL: Do NOT launch agents. If stuck, STATUS=BLOCKED.

## Context

Tesla sends values in whatever unit the car's GUI is set to. The unit preference
is sent as signals: `SettingDistanceUnit`, `SettingTemperatureUnit`, `SettingTirePressureUnit`.
These are in signal_log alongside the measurement values.

Internal storage is always: **miles, °C, PSI**. Conversion happens at session
completion (Go) and at display time (frontend).

## Task

### 1. Create `internal/units/convert.go`

```go
package units

// Tesla SettingDistanceUnit values
const (
    DistUnknown    = ""
    DistMiles      = "Miles"
    DistKilometers = "Kilometers"
)

// Tesla SettingTemperatureUnit values
const (
    TempUnknown    = ""
    TempFahrenheit = "Fahrenheit"
    TempCelsius    = "Celsius"
)

// Tesla SettingTirePressureUnit values
const (
    PressUnknown = ""
    PressPSI     = "Psi"
    PressBar     = "Bar"
)

// NormalizeDistance converts a distance value to miles.
func NormalizeDistance(value float64, fromUnit string) float64 {
    switch fromUnit {
    case DistKilometers: return value / 1.60934
    default: return value // Miles or unknown → assume miles
    }
}

// NormalizeSpeed converts a speed value to mph.
func NormalizeSpeed(value float64, fromUnit string) float64 {
    return NormalizeDistance(value, fromUnit) // same ratio
}

// NormalizeTemp converts a temperature value to °C.
func NormalizeTemp(value float64, fromUnit string) float64 {
    switch fromUnit {
    case TempFahrenheit: return (value - 32) * 5 / 9
    default: return value // Celsius or unknown → assume Celsius
    }
}

// NormalizePressure converts a pressure value to PSI.
func NormalizePressure(value float64, fromUnit string) float64 {
    switch fromUnit {
    case PressBar: return value * 14.5038
    default: return value // PSI or unknown → assume PSI
    }
}

// GetUnitFromSnapshot extracts a unit preference from a signal snapshot.
func GetUnitFromSnapshot(snapshot map[string]interface{}, signalName string) string {
    if v, ok := snapshot[signalName]; ok {
        if s, ok := v.(string); ok { return s }
    }
    return ""
}
```

### 2. Create/extend `web/src/lib/unitConversion.ts`

```typescript
export function milesToKm(miles: number): number { return miles * 1.60934 }
export function kmToMiles(km: number): number { return km / 1.60934 }
export function celsiusToFahrenheit(c: number): number { return c * 9/5 + 32 }
export function fahrenheitToCelsius(f: number): number { return (f - 32) * 5/9 }
export function psiToBar(psi: number): number { return psi / 14.5038 }
export function barToPsi(bar: number): number { return bar * 14.5038 }

/** Convert a value from internal units to user's display preference */
export function convertDistance(miles: number, toUnit: 'mi' | 'km'): number {
    return toUnit === 'km' ? milesToKm(miles) : miles
}
export function convertTemp(celsius: number, toUnit: '°C' | '°F'): number {
    return toUnit === '°F' ? celsiusToFahrenheit(celsius) : celsius
}
export function convertPressure(psi: number, toUnit: 'PSI' | 'bar'): number {
    return toUnit === 'bar' ? psiToBar(psi) : psi
}
```

If `web/src/lib/unitConversion.ts` or `web/src/hooks/useSettings.ts` already has
conversion functions, extend them rather than creating duplicates.

## Gate

```powershell
cd D:\repos\teslasync
go build ./...
cd web && npx tsc --noEmit
```

Log result. STATUS=DONE only if both pass.
