---
description: "Fix driving page runtime errors — null safety, NaN gauges, camelCase hooks"
---

# Fix Driving Page Runtime Errors + camelCase Hooks in 3 Other Files

## ⛔ DO NOT skip any step. DO NOT use `git mv`. Every fix must be verified.

**Branch:** `refactor/full-rewrite`

---

## PART 1 — Fix camelCase Query Parameters in 3 Hook Files

Three hook files still send `vehicleId=` (camelCase) in URLs, but the Go backend
expects `vehicle_id=` (snake_case). This causes 400 errors or wrong results.

### File 1: `web/src/api/hooks/useCharging.ts`

**Line 26** — fix the URL parameter:
```
WRONG:  `/charging-sessions?vehicleId=${vehicleId}`
RIGHT:  `/charging-sessions?vehicle_id=${vehicleId}`
```

Also add `enabled` guard to `useChargingSessions` (currently missing):
```typescript
export function useChargingSessions(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? chargingKeys.byVehicle(vehicleId) : chargingKeys.all,
    queryFn: () => request<ChargingSession[]>(
      vehicleId ? `/charging-sessions?vehicle_id=${vehicleId}` : '/charging-sessions',
    ),
    enabled: !!vehicleId,  // ← ADD THIS
  });
}
```

### File 2: `web/src/api/hooks/useTrips.ts`

**Line 13** — fix the URL parameter AND add `enabled` guard:
```typescript
export function useTrips(vehicleId?: string) {
  return useQuery({
    queryKey: vehicleId ? [...tripKeys.all, vehicleId] : tripKeys.all,
    queryFn: () => request<Trip[]>(vehicleId ? `/trips?vehicle_id=${vehicleId}` : '/trips'),
    enabled: !!vehicleId,  // ← ADD THIS
  });
}
```

### File 3: `web/src/api/hooks/useLocations.ts`

**Line 14** — fix the URL parameter AND add `enabled` guard:
```typescript
export function useLocations(vehicleId?: string) {
  return useQuery({
    queryKey: locationKeys.all(vehicleId),
    queryFn: () => request<Location[]>(
      vehicleId ? `/locations?vehicle_id=${vehicleId}` : '/locations',
    ),
    enabled: !!vehicleId,  // ← ADD THIS
  });
}
```

### Verify Part 1:
```bash
# Must be ZERO camelCase params across ALL hook files
grep -rn "vehicleId=" web/src/api/hooks/ --include="*.ts"
# Expected: 0 matches

# Must have snake_case params
grep -rn "vehicle_id=" web/src/api/hooks/ --include="*.ts" | wc -l
# Expected: 15+ matches
```

---

## PART 2 — Fix Null-Safety Crash in DrivingDynamicsPage.tsx

**File:** `web/src/features/driving/pages/DrivingDynamicsPage.tsx`

**Line 179** — `d.startDate.slice(0, 10)` crashes when `startDate` is undefined/null.
This is the cause of: **"Cannot read properties of undefined (reading 'slice')"**

**Fix:** Add optional chaining:
```typescript
// BEFORE (line 179):
const driveDate = d.startDate.slice(0, 10);

// AFTER:
const driveDate = d.startDate?.slice(0, 10) ?? '';
```

### Verify:
```bash
grep -n "\.startDate\.slice\|\.startDate\.substring" web/src/features/driving/pages/DrivingDynamicsPage.tsx
# Must be 0 — all must use ?. optional chaining
```

---

## PART 3 — Fix NaN in SpeedProfilePage.tsx Gauges

**File:** `web/src/features/driving/pages/SpeedProfilePage.tsx`

**Lines 112, 119, 126** — gauges show "NaN km/h" when API returns null/undefined fields.
The `data` object exists (so the `{data && ...}` guard passes) but individual fields
like `avgSpeedKmh` may be `undefined` or `null`.

**Fix all three RadialGauge values:**
```typescript
// Line 112: avgSpeedKmh gauge
value={Math.round(convertSpeed(data.avgSpeedKmh ?? 0))}

// Line 119: peakSpeedKmh gauge
value={Math.round(convertSpeed(data.peakSpeedKmh ?? 0))}

// Line 126: optimalSpeedKmh gauge
value={Math.round(convertSpeed(data.optimalSpeedKmh ?? 0))}
```

Also fix line 206 — the optimalSpeed insight guard:
```typescript
// BEFORE:
{data.optimalSpeedKmh > 0 && (

// AFTER (safe against undefined):
{(data.optimalSpeedKmh ?? 0) > 0 && (
```

### Verify:
```bash
grep -n "data\.\(avgSpeed\|peakSpeed\|optimalSpeed\)" web/src/features/driving/pages/SpeedProfilePage.tsx
# Every occurrence must have ?? 0 fallback
```

---

## PART 4 — Fix NaN in RegenEfficiencyPage.tsx

**File:** `web/src/features/driving/pages/RegenEfficiencyPage.tsx`

**Lines 123, 127, 131-133, 144, 151, 158, 165** — gauges and stat cards show "NaN"
when API data fields are null/undefined.

**Fix the RadialGauge (line 123):**
```typescript
value={Math.round(data.regenRatio ?? 0)}
```

**Fix regenColor call (line 127):**
```typescript
color={regenColor(data.regenRatio ?? 0)}
```

**Fix the info text (lines 131-133):**
```typescript
kwh: fmtNumber(data.totalRegenKwh ?? 0),
charges: fmtNumber(data.freeCharges ?? 0),
```

**Fix stat cards — add ?? 0 to AnimatedNumber values:**
```typescript
// Line 144:
<AnimatedNumber value={data.totalRegenKwh ?? 0} decimals={1} />

// Line 151:
{fmtPercent(data.regenRatio ?? 0)}

// Line 158:
<AnimatedNumber value={data.monthlyAvgKw ?? 0} decimals={1} />

// Line 165:
<AnimatedNumber value={data.freeCharges ?? 0} decimals={1} />
```

**Fix MetricBar values (lines 198-210):**
```typescript
<MetricBar label={...} value={data.totalRegenKwh ?? 0} max={Math.max(data.totalRegenKwh ?? 0, 100)} color="#10b981" />
<MetricBar label={...} value={data.regenRatio ?? 0} max={100} color="#00f0ff" />
<MetricBar label={...} value={data.monthlyAvgKw ?? 0} max={Math.max(data.monthlyAvgKw ?? 0, 50)} color="#a855f7" />
<MetricBar label={...} value={data.freeCharges ?? 0} max={Math.max(data.freeCharges ?? 0, 10)} color="#f59e0b" />
```

**Fix fmtNumber calls (lines 199, 203, 207, 211):**
```typescript
{fmtNumber(data.totalRegenKwh ?? 0)} kWh
{fmtPercent(data.regenRatio ?? 0)}
{fmtNumber(data.monthlyAvgKw ?? 0)} kW
{fmtNumber(data.freeCharges ?? 0)}
```

### Verify:
```bash
grep -n "data\.\(totalRegenKwh\|regenRatio\|monthlyAvgKw\|freeCharges\)" web/src/features/driving/pages/RegenEfficiencyPage.tsx
# Every occurrence must have ?? 0 fallback
```

---

## PART 5 — Fix Division-by-Zero in DriveDetailPage.tsx

**File:** `web/src/features/driving/pages/DriveDetailPage.tsx`

**Line 157** — `speeds.reduce(...) / speeds.length` → NaN when speeds is empty:
```typescript
// BEFORE:
const avgSpd = drive.speedAvg != null ? convertSpeed(drive.speedAvg) : speeds.reduce((a, b) => a + b, 0) / speeds.length;

// AFTER:
const avgSpd = drive.speedAvg != null
  ? convertSpeed(drive.speedAvg)
  : speeds.length > 0
    ? speeds.reduce((a, b) => a + b, 0) / speeds.length
    : 0;
```

**Line 163** — same issue:
```typescript
// BEFORE:
const avgPower = powers.reduce((a, b) => a + b, 0) / powers.length;

// AFTER:
const avgPower = powers.length > 0 ? powers.reduce((a, b) => a + b, 0) / powers.length : 0;
```

**Line 166** — same issue (division by chartData.length):
```typescript
// BEFORE:
const regenWh = chartData.filter((d) => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) * (durationH / chartData.length) * 1000;

// AFTER:
const regenWh = chartData.length > 0
  ? chartData.filter((d) => d.power < 0).reduce((s, d) => s + Math.abs(d.power), 0) * (durationH / chartData.length) * 1000
  : 0;
```

### Verify:
```bash
grep -n "/ speeds.length\|/ powers.length\|/ chartData.length" web/src/features/driving/pages/DriveDetailPage.tsx
# Each must be guarded with length > 0 check
```

---

## PART 6 — Fix Date Safety in RegenEfficiencyPage.tsx

**Line 66 and 94** — `d.startDate?.substring(0, 7)` and `formatDateShort(d.startDate)`:

Line 66 already uses optional chaining (good). But line 94 passes `d.startDate` directly:
```typescript
// BEFORE:
date: formatDateShort(d.startDate),

// AFTER:
date: d.startDate ? formatDateShort(d.startDate) : '—',
```

---

## FINAL VERIFICATION — ALL must pass

```bash
echo "=== 1. No camelCase params in ANY hook file ==="
WRONG=$(grep -rc "vehicleId=" web/src/api/hooks/ --include="*.ts" 2>/dev/null | awk -F: '{s+=$2}END{print s}')
echo "  camelCase params (must be 0): $WRONG"

echo ""
echo "=== 2. All hooks have enabled guards ==="
for f in web/src/api/hooks/useCharging.ts web/src/api/hooks/useTrips.ts web/src/api/hooks/useLocations.ts; do
  HOOKS=$(grep -c "export function" "$f")
  ENABLED=$(grep -c "enabled:" "$f")
  echo "  $f: hooks=$HOOKS, enabled=$ENABLED"
done

echo ""
echo "=== 3. No unsafe .slice() or .substring() on nullable fields ==="
grep -rn "\.startDate\.slice\|\.startDate\.substring\|\.endDate\.slice" web/src/features/driving/ --include="*.tsx"
echo "  (must be empty — all should use ?.)"

echo ""
echo "=== 4. No unguarded division ==="
grep -n "/ speeds\.length\|/ powers\.length\|/ chartData\.length" web/src/features/driving/pages/DriveDetailPage.tsx
echo "  (each must have a > 0 guard)"

echo ""
echo "=== 5. NaN safety — all data fields have ?? 0 ==="
grep -n "data\.avgSpeedKmh[^?]" web/src/features/driving/pages/SpeedProfilePage.tsx
grep -n "data\.peakSpeedKmh[^?]" web/src/features/driving/pages/SpeedProfilePage.tsx
grep -n "data\.optimalSpeedKmh[^?]" web/src/features/driving/pages/SpeedProfilePage.tsx
grep -n "data\.regenRatio[^?]" web/src/features/driving/pages/RegenEfficiencyPage.tsx
grep -n "data\.totalRegenKwh[^?]" web/src/features/driving/pages/RegenEfficiencyPage.tsx
grep -n "data\.monthlyAvgKw[^?]" web/src/features/driving/pages/RegenEfficiencyPage.tsx
grep -n "data\.freeCharges[^?]" web/src/features/driving/pages/RegenEfficiencyPage.tsx
echo "  (must be empty — all accessed via ?? 0)"

echo ""
echo "=== 6. TypeScript ==="
cd web && npx tsc --noEmit 2>&1 | tail -5
echo ""

echo "=== 7. Inline styles per driving page (each ≤ 2) ==="
for f in $(find web/src/features/driving/ -name "*.tsx"); do
  COUNT=$(grep -c "style={" "$f" 2>/dev/null)
  NAME=$(basename "$f")
  if [ "$COUNT" -gt 2 ]; then echo "❌ $NAME: $COUNT"; else echo "✅ $NAME: $COUNT"; fi
done
```

**All checks must pass. Zero NaN. Zero camelCase params. Zero unguarded divisions.**

---

## COMMIT MESSAGE

```
fix: null-safety + camelCase hooks — prevent NaN, crashes, and 400 errors

- useCharging.ts: vehicle_id= (was vehicleId=), add enabled guard
- useTrips.ts: vehicle_id= (was vehicleId=), add enabled guard
- useLocations.ts: vehicle_id= (was vehicleId=), add enabled guard
- DrivingDynamicsPage: optional chaining on startDate.slice()
- SpeedProfilePage: ?? 0 fallbacks on all gauge values
- RegenEfficiencyPage: ?? 0 fallbacks on all data fields
- DriveDetailPage: division-by-zero guards on array reductions

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
