---
applyTo: "web/src/lib/**,web/src/features/**,web/src/api/**"
---

# Unit Conversion & Display Instructions

## The Two-Unit Problem

TeslaSync has TWO independent unit settings that may differ:

| Setting | Source | Where stored | Example |
|---|---|---|---|
| **Car's GUI unit** | Tesla car hardware | `vehicle_units.car_*_pref` | Car displays km/h |
| **User's display preference** | TeslaSync Settings page | `settings.unit_of_*` | User wants mph |

Raw values from the car arrive in whatever unit the car's GUI is set to.
The API returns raw values + the unit they're in. The frontend must convert
if the two don't match.

## API Response Shape

Every measurement endpoint returns the unit the data was stored in:

```json
{
  "distance_mi": 42.3,
  "distance_unit": 1,
  "avg_speed_mph": 65.2,
  "outside_temp_avg_c": 22.5,
  "temp_unit": 2
}
```

Unit enum values (match Tesla proto):
```
DistanceUnit:    0=Unknown, 1=Miles, 2=Kilometers
TemperatureUnit: 0=Unknown, 1=Fahrenheit, 2=Celsius
PressureUnit:    0=Unknown, 1=PSI, 2=Bar
```

## Conversion Utility — `@/lib/unitConversion`

```typescript
import {
  toDisplayDistance,    // converts distance values (mi ↔ km)
  toDisplayTemperature, // converts temperature (F ↔ C)
  toDisplayPressure,    // converts pressure (PSI ↔ bar)
  convertDistance,      // also works for speed (mph ↔ km/h)
  distanceLabel,        // → "mi" | "km"
  speedLabel,           // → "mph" | "km/h"
  temperatureLabel,     // → "°F" | "°C"
  pressureLabel,        // → "PSI" | "bar"
  DistanceUnit,
  TemperatureUnit,
  PressureUnit,
} from '@/lib/unitConversion';
```

## Page Pattern — How to Wire Conversion

### Step 1: Get the user's display preference from Settings

```typescript
import { useSettings } from '@/api/hooks/useSettings';

const { data: settings } = useSettings();

// Map settings strings to enum values
const userDistUnit = settings?.unit_of_length === 'km'
  ? DistanceUnit.Kilometers
  : DistanceUnit.Miles;

const userTempUnit = settings?.unit_of_temp === 'C'
  ? TemperatureUnit.Celsius
  : TemperatureUnit.Fahrenheit;

const userPressureUnit = settings?.unit_of_pressure === 'bar'
  ? PressureUnit.Bar
  : PressureUnit.PSI;
```

### Step 2: Get the data's source unit from the API response

```typescript
const drive = useDriveDetail(driveId);
// drive.distance_unit → 1 (Miles) or 2 (Kilometers)
// drive.temp_unit → 1 (Fahrenheit) or 2 (Celsius)
```

### Step 3: Convert and display

```typescript
// Convert distance: raw value, from unit, to unit, decimal precision
const displayDistance = toDisplayDistance(
  drive.distance_mi ?? 0,
  drive.distance_unit ?? 0,
  userDistUnit,
  1  // 1 decimal place (from Settings.decimal_precision)
);

// Convert speed (same function, same unit enum)
const displaySpeed = toDisplayDistance(
  drive.avg_speed_mph ?? 0,
  drive.distance_unit ?? 0,
  userDistUnit,
  0  // 0 decimal places for speed
);

// Convert temperature
const displayTemp = toDisplayTemperature(
  drive.outside_temp_avg_c ?? 0,
  drive.temp_unit ?? 0,
  userTempUnit,
  1
);

// Display with correct label
<StatCard
  label={t('drive.distance')}
  value={displayDistance}
  suffix={distanceLabel(userDistUnit)}
/>
<StatCard
  label={t('drive.avgSpeed')}
  value={displaySpeed}
  suffix={speedLabel(userDistUnit)}
/>
<StatCard
  label={t('drive.outsideTemp')}
  value={displayTemp}
  suffix={temperatureLabel(userTempUnit)}
/>
```

## Rules

### Label shows USER's preference, not the data's source unit
```typescript
// ✅ GOOD — label matches what user SEES after conversion
suffix={distanceLabel(userDistUnit)}

// ❌ BAD — label from source unit (confusing if converted)
suffix={distanceLabel(drive.distance_unit)}
```

### Handle Unknown (0) gracefully
```typescript
// When either unit is Unknown (0), the converter returns the raw value unchanged
// Display with a "?" or default label
const label = drive.distance_unit === 0
  ? `${distanceLabel(userDistUnit)}?`  // "mi?" signals uncertain data
  : distanceLabel(userDistUnit);
```

### Null safety on numeric values
```typescript
// ✅ GOOD — always ?? 0 before converting
toDisplayDistance(drive.distance_mi ?? 0, ...)

// ❌ BAD — null/undefined passed to converter
toDisplayDistance(drive.distance_mi, ...)  // crashes if null
```

### Precision from Settings
```typescript
// Use the user's decimal_precision setting, not hardcoded
const precision = settings?.decimal_precision ?? 1;
toDisplayDistance(value, from, to, precision);
```

### Charts — convert ALL data points
```typescript
const chartData = useMemo(() =>
  (drives ?? []).map(d => ({
    date: d.start_ts,
    distance: toDisplayDistance(d.distance_mi ?? 0, d.distance_unit ?? 0, userDistUnit, 1),
    speed: toDisplayDistance(d.avg_speed_mph ?? 0, d.distance_unit ?? 0, userDistUnit, 0),
  })),
  [drives, userDistUnit]
);

// Chart axis label uses user's unit
<YAxis label={distanceLabel(userDistUnit)} />
```

## Conversion Factors (for reference)

| Conversion | Factor | Formula |
|---|---|---|
| Miles → Kilometers | × 1.60934 | `mi * 1.60934` |
| Kilometers → Miles | × 0.621371 | `km * 0.621371` |
| Fahrenheit → Celsius | — | `(F - 32) × 5/9` |
| Celsius → Fahrenheit | — | `C × 9/5 + 32` |
| PSI → Bar | × 0.0689476 | `psi * 0.0689476` |
| Bar → PSI | × 14.5038 | `bar * 14.5038` |
| mph → km/h | × 1.60934 | same as miles→km |
| km/h → mph | × 0.621371 | same as km→miles |

## Which Pages Need Conversion

| Page | Values | Unit type |
|---|---|---|
| Dashboard | distance, speed, temp | Distance + Temp |
| Drives list/detail | distance, speed, temp, battery% | Distance + Temp |
| Charging list/detail | energy added (range), battery% | Distance |
| Tire Pressure | FL/FR/RL/RR | Pressure |
| Climate | inside/outside temp, setpoints | Temperature |
| Trips | total distance | Distance |
| Analytics (TCO, fleet, efficiency) | distance, energy, temp | Distance + Temp |
| Drive telemetry charts | speed, temp over time | Distance + Temp |

## Anti-Patterns

```
❌ DO NOT convert values in the API hook (hooks return raw data)
❌ DO NOT store converted values in state (derive on render)
❌ DO NOT assume all data is in the same unit (each row has its own unit tag)
❌ DO NOT hardcode conversion factors in page components (use @/lib/unitConversion)
❌ DO NOT show the source unit label when displaying converted values
❌ DO NOT skip conversion for "simple" pages (consistency across all pages)
```
