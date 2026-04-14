---
description: "Fix decimal precision — replace 47 .toFixed() and ~80 Math.round() display bypasses with fmtNumber(), ensure default is 2"
---

# Fix: Honour User Decimal Precision Setting Everywhere

## Problem

Settings page has a "Decimal Precision" field (default: 2) but ~127 display values
bypass it by using `Math.round()` or `.toFixed(N)` instead of `fmtNumber()`.

The formatter system works correctly — `fmtNumber()` reads the global precision
set by `useSettings`. But many pages hardcode rounding.

## Step 0 — Fix Default Precision Inconsistency

There's a bug: `useSettings.ts` line 47 has `?? 1` but the default should be `?? 2`.

**File:** `web/src/hooks/useSettings.ts` line 47:
```typescript
// ❌ BEFORE — falls back to 1 instead of 2
const decimals = s.decimal_precision ?? 1

// ✅ AFTER — consistent default of 2
const decimals = s.decimal_precision ?? 2
```

Also verify these are consistent:
- `web/src/hooks/useSettings.ts` line 19: `decimal_precision: 2` ✅
- `web/src/lib/numberFormat.ts` line 2: `let _globalPrecision = 2` ✅

## Step 1 — Replace `.toFixed(N)` with `fmtNumber()` (47 instances)

**Find them:**
```bash
grep -rn "\.toFixed(" web/src/features/ --include="*.tsx"
```

**Fix pattern:**
```typescript
// ❌ BEFORE — hardcoded decimals, ignores user setting
`${(value).toFixed(2)} kWh`
`${(bytes / 1024).toFixed(1)} KB`

// ✅ AFTER — uses global precision
`${fmtNumber(value)} kWh`
// OR for file sizes (always 1 decimal — acceptable exception):
`${fmtNumber(bytes / 1024, 1)} KB`
```

**Acceptable exceptions (keep `.toFixed()`):**
- File size formatting (KB/MB/GB) — always 1 decimal, not user-preference
- Percentage in CSS `style={{ width: \`${pct.toFixed(0)}%\` }}` — needs integer for CSS

**Files to fix (replace .toFixed with fmtNumber):**
```
ChargingListPage.tsx      — 6 instances
BackupRestorePage.tsx      — 5 (file sizes — keep toFixed(1), exception)
BatteryCellsPage.tsx       — 5 instances
DataExportPage.tsx         — 4 (file sizes — keep toFixed(1), exception)
TirePressurePage.tsx       — 4 instances
DBHealthPage.tsx           — 3 (file sizes — keep toFixed(1), exception)
EfficiencyPage.tsx         — 3 instances
NavigationRoutePage.tsx    — 3 instances
BatteryHealthPage.tsx      — 2 instances
SpeedProfilePage.tsx       — 1
SignalLogViewerPage.tsx    — 1
RegenEfficiencyPage.tsx    — 1
DrivesListPage.tsx         — 1
GeofencesPage.tsx          — 1
CostAnalysisPage.tsx       — 1
ComparePage.tsx            — 1
ClimateControlPage.tsx     — 1
ChargingCurvePage.tsx      — 1
LocationsPage.tsx          — 1
TrueCostPage.tsx           — 1
```

Import `fmtNumber` if not already imported:
```typescript
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
```

## Step 2 — Replace display `Math.round()` with `fmtNumber()` (~80 instances)

**Find display usages (inside JSX `{}` or template literals):**
```bash
grep -rn "Math\.round(" web/src/features/ --include="*.tsx"
```

**Fix pattern:**
```typescript
// ❌ BEFORE — rounds to integer, ignores precision setting
value={`${Math.round(convertDistance(range))} ${distanceUnit}`}
value={Math.round(stats.avgPower)}

// ✅ AFTER — respects user precision
value={`${fmtNumber(convertDistance(range))} ${distanceUnit}`}
value={fmtNumber(stats.avgPower)}

// For values that SHOULD be integers (count of drives, number of readings):
value={fmtInt(stats.totalDrives)}  // fmtInt already exists, uses 0 decimals
```

**DO NOT replace `Math.round()` when used for:**
- Array indexing: `data[Math.round(i)]` — keep
- Loop control: `for (let i = 0; i < Math.round(n); i++)` — keep
- Chart data computation: `{ soc: Math.round(soc), power: ... }` — keep (internal data, not display)
- CSS pixel values: `style={{ height: Math.round(px) }}` — keep
- Gauge max/min values: `max={Math.round(maxVal)}` — keep (component prop, not display text)

**Only replace when the result goes directly to user-visible text in JSX.**

**Top files to fix:**
```
DriveDetailPage.tsx        — 31 Math.round (many are display values)
DriveScorePage.tsx         — 14
VehicleHero.tsx            — 12
EfficiencyPage.tsx         — 12
SpeedProfilePage.tsx       — 11
StatisticsPage.tsx         — 7
VehicleGauges.tsx          — 6
DrivesListPage.tsx         — 6
VehicleListPage.tsx        — 6
BatteryHealthPage.tsx      — 5
ChargingCurvePage.tsx      — 5
RouteEfficiencyPage.tsx    — 5
```

**Key distinction for gauge values:**
```typescript
// RadialGauge value prop — keep Math.round (gauge needs integer input)
<RadialGauge value={Math.round(convertDistance(range))} max={600} ... />
// This is OK — the gauge component renders the number, and it needs a clean integer

// BUT for text display next to gauge — use fmtNumber
<span>{fmtNumber(convertDistance(range))} {distanceUnit}</span>
```

## Step 3 — Verify the Pipeline

After all changes, verify the precision flows correctly:

1. User sets "Decimal Precision: 3" in Settings
2. `useSettings` calls `setGlobalPrecision(3)`
3. `fmtNumber(42.5678)` → returns `"42.568"`
4. Every page display value respects this

```bash
cd web

# TypeScript must pass
npx tsc --noEmit

# Count remaining bypasses — should be significantly reduced
echo "=== Remaining .toFixed() ==="
grep -rn "\.toFixed(" src/features/ --include="*.tsx" | wc -l
# Target: < 15 (file size exceptions only)

echo "=== Remaining display Math.round() ==="
grep -rn "Math\.round(" src/features/ --include="*.tsx" | wc -l
# Target: < 50 (computation + gauge props only, no display text)

echo "=== fmtNumber usages ==="
grep -rn "fmtNumber\|fmtInt\|fmtPercent" src/features/ --include="*.tsx" | wc -l
# Target: > 750 (up from 666)
```

## Engineering Rules
- Import `fmtNumber`/`fmtInt` from `@/lib/numberFormat` — never hardcode rounding
- `fmtNumber(value)` — uses user's decimal precision setting
- `fmtNumber(value, N)` — override with specific decimals (use sparingly)
- `fmtInt(value)` — always 0 decimals (for counts, IDs, whole numbers)
- `fmtPercent(value)` — appends % with user's precision
- DO NOT revert to old code patterns

**COMPLETION DEFINITION:**
- [ ] Default precision fallback fixed to `?? 2` in useSettings.ts
- [ ] `.toFixed()` replaced with `fmtNumber()` (except file size exceptions)
- [ ] Display `Math.round()` replaced with `fmtNumber()` or `fmtInt()`
- [ ] Computation/gauge `Math.round()` left unchanged
- [ ] `.toFixed()` count < 15 (file sizes only)
- [ ] `fmtNumber` usage count > 750
- [ ] TypeScript compiles clean
