---
description: "Fix Safety Settings live signals + alignment, Drive Detail tire pressure, Driving Statistics"
---

# Fix: Safety Settings — Missing Live Safety Signals + Driving Statistics

> Batch 3 agent added ADAS features grid, Safety States chart, and History table.
> But 2 panels from the pre-refactoring prod are still missing.

## Bug 1 — Live Safety Signals panel missing

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`
**Screenshot (from prod):** 4 cards in a row:
- **Driver Belt** — icon: person with seatbelt, value: "Buckled" (green), label: "DRIVER BELT"
- **Passenger Belt** — icon: person with seatbelt (red), value: "Unbuckled" (red), label: "PASSENGER BELT"  
- **Driver Seat** — icon: steering wheel, value: "Empty", label: "DRIVER SEAT"
- **Vehicle Lock** — icon: lock, value: "Locked" (green), label: "VEHICLE LOCK"

**Data source:** These come from vehicle live state (`/vehicles/{id}/state`):
- `driver_seat_belt` → "Buckled" / "Unbuckled"
- `passenger_seat_belt` → "Buckled" / "Unbuckled"
- `driver_seat_occupied` → "Occupied" / "Empty"
- `locked` → "Locked" / "Unlocked"

After `camelCaseKeys`: `driverSeatBelt`, `passengerSeatBelt`, `driverSeatOccupied`, `locked`

**Fix:** Add a "Live Safety Signals" section after the summary cards:
```tsx
<FadeIn>
  <GlassPanel className="p-5">
    <p className="mb-4 text-sm font-semibold text-white/90">
      {t('safety.liveSignals', 'Live Safety Signals')}
    </p>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <SignalCard
        icon={<UserCheck className="h-6 w-6" />}
        value={state?.driverSeatBelt ?? state?.driver_seat_belt ?? '—'}
        label={t('safety.driverBelt', 'Driver Belt')}
        positive={isBuckled(state?.driverSeatBelt ?? state?.driver_seat_belt)}
      />
      <SignalCard
        icon={<UserCheck className="h-6 w-6" />}
        value={state?.passengerSeatBelt ?? state?.passenger_seat_belt ?? '—'}
        label={t('safety.passengerBelt', 'Passenger Belt')}
        positive={isBuckled(state?.passengerSeatBelt ?? state?.passenger_seat_belt)}
      />
      <SignalCard
        icon={<Armchair className="h-6 w-6" />}
        value={isOccupied(state?.driverSeatOccupied ?? state?.driver_seat_occupied) ? 'Occupied' : 'Empty'}
        label={t('safety.driverSeat', 'Driver Seat')}
      />
      <SignalCard
        icon={<Lock className="h-6 w-6" />}
        value={(state?.locked ?? false) ? 'Locked' : 'Unlocked'}
        label={t('safety.vehicleLock', 'Vehicle Lock')}
        positive={state?.locked ?? false}
      />
    </div>
  </GlassPanel>
</FadeIn>
```

Create a simple `SignalCard` inline component:
```tsx
function SignalCard({ icon, value, label, positive }: {
  icon: React.ReactNode; value: string; label: string; positive?: boolean;
}) {
  const color = positive === true ? 'text-green-400' : positive === false ? 'text-red-400' : 'text-white/70';
  return (
    <GlassPanel className="p-4 flex flex-col items-center gap-2 text-center">
      <span className={color}>{icon}</span>
      <span className={cn('text-sm font-bold', color)}>{value}</span>
      <span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
    </GlassPanel>
  );
}
```

**Data hook:** Use `useVehicleLive(vehicleId)` or add a query to `/vehicles/{id}/state`.

## Bug 2 — Driving Statistics panel missing

**Screenshot (from prod):** 2 cards side by side:
- **Miles Since Reset** — icon: road, value: "566.65", unit badge: "miles"
- **Self-Driving Miles** — icon: steering wheel, value: "26.84", unit badge: "miles (autopilot)"

**Data source:** From vehicle live state:
- `miles_since_last_charge` or `odometer` distance tracking → "Miles Since Reset"
- `drive_state.autopilot_state` accumulated miles → "Self-Driving Miles"

Or from a dedicated stats endpoint. Check:
```bash
grep -rn "miles_since\|self_driving\|autopilot_miles\|drive_score" internal/api/
```

**Fix:** Add "Driving Statistics" section after Live Safety Signals:
```tsx
<FadeIn delay={0.1}>
  <GlassPanel className="p-5">
    <p className="mb-4 text-sm font-semibold text-white/90">
      {t('safety.drivingStats', 'Driving Statistics')}
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <MetricCard
        icon={<Navigation className="h-5 w-5" />}
        label={t('safety.milesSinceReset', 'Miles Since Reset')}
        value={fmtNumber(state?.milesSinceReset ?? state?.miles_since_reset ?? 0)}
        subtitle="miles"
      />
      <MetricCard
        icon={<Cpu className="h-5 w-5" />}
        label={t('safety.selfDrivingMiles', 'Self-Driving Miles')}
        value={fmtNumber(state?.selfDrivingMiles ?? state?.autopilot_miles ?? 0)}
        subtitle="miles (autopilot)"
      />
    </div>
  </GlassPanel>
</FadeIn>
```

## Bug 3 — Safety Settings: Score gauge + summary cards misaligned

**Page:** `web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx`
**Screenshot:** The Safety Score radial gauge takes a huge column (~40% width) while the 4
summary cards (Safety Score 78%, Total Features 9, Enabled 7, Disabled 2) are squeezed into
narrow columns on the right. The gauge is much taller than the cards, leaving wasted space.

**Expected (from prod):** Gauge and cards are in a balanced row — gauge is smaller, cards
have equal width, all same height.

**Fix:** Adjust the grid layout. Currently likely `lg:grid-cols-5` with gauge spanning 2 cols.
Change to a more balanced layout:
```tsx
{/* Option A: Gauge smaller, cards equal */}
<div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-stretch">
  <GlassPanel className="p-4 flex flex-col items-center justify-center">
    <RadialGauge value={enabled} max={TOTAL_FEATURES} size={120} />
    <p className="text-xs text-white/50 mt-2">Safety Score</p>
    <Badge variant="success" size="sm">{enabled}/{TOTAL_FEATURES} enabled</Badge>
  </GlassPanel>
  {/* 4 cards each take 1 col */}
  <MetricCard label="Safety Score" value={`${pct}%`} />
  <MetricCard label="Total Features" value={TOTAL_FEATURES} />
  <MetricCard label="Enabled" value={enabled} color="green" />
  <MetricCard label="Disabled" value={TOTAL_FEATURES - enabled} color="red" />
</div>
```

Key changes:
- Remove `lg:col-span-2` from gauge panel — give it just 1 column
- Use `items-stretch` so all cards are same height
- Reduce gauge `size` from ~200 to ~120 to fit the narrower column
- Or use `lg:grid-cols-5` with gauge at col-span-1

---

## Bug 4 — Drive Detail: Tire Pressure During Drive still empty

**Page:** `web/src/features/driving/pages/DriveDetailPage.tsx`
**Screenshot:** "Tire Pressure During Drive" panel shows "No telemetry data available".

**Root Cause:** The `drive_telemetry_readings` table has `tire_pressure_fl/fr/rl/rr` columns
but they're all NULL. The `flushDriveTelemetry()` function in `telemetry_sessions.go` doesn't
map TPMS signals from Fleet Telemetry into these columns.

Check signal names in our export:
```bash
node -e "const d=require('./scripts/signals-export.json'); const tpms=d.filter(s=>s.signal.match(/tpms|tire/i)); console.log([...new Set(tpms.map(s=>s.signal))])"
```

Fleet Telemetry sends: `TpmsFl`, `TpmsFr`, `TpmsRl`, `TpmsRr` (pressure in Bar).

**Fix:** In `internal/api/telemetry_sessions.go`, find `flushDriveTelemetry()` and add TPMS mapping:

```go
// In the reading construction, add:
if v, ok := toFloatOk(signals["TpmsFl"]); ok {
    reading.TirePressureFL = &v
}
if v, ok := toFloatOk(signals["TpmsFr"]); ok {
    reading.TirePressureFR = &v
}
if v, ok := toFloatOk(signals["TpmsRl"]); ok {
    reading.TirePressureRL = &v
}
if v, ok := toFloatOk(signals["TpmsRr"]); ok {
    reading.TirePressureRR = &v
}
```

Also check if `flushDriveTelemetry` accumulates these signal names — the MQTT subscriber
may deliver them as `TpmsFl` but the accumulator might use a different key.

---

## Bug 5 — Sleep Efficiency: "Monthly Sentry Mode Impact" overlaps "Sentry vs No-Sentry" panel

**Page:** `web/src/features/battery/pages/SleepEfficiencyPage.tsx`
**Screenshot:** The "Monthly Sentry Mode Impact" card (0.00% Extra drain/hr, 0.00 kWh, $0.00)
overlaps/overflows into the bottom of the "Sentry vs No-Sentry" panel. It looks like the
impact card is positioned absolutely or has a negative margin pushing it into the panel above.

**Fix:** Check the layout of the "Sentry vs No-Sentry" section and the "Monthly Sentry Mode
Impact" card. They should be stacked vertically, not overlapping:

1. Find the Monthly Sentry Mode Impact card and ensure it's inside the grid flow (not
   absolutely positioned or with negative margins)
2. If it's inside the Sentry vs No-Sentry panel, make sure the panel has enough height:
   ```tsx
   <GlassPanel className="p-5 flex flex-col">
     <p className="text-sm font-semibold">Sentry vs No-Sentry</p>
     {/* chart or empty state */}
     <div className="mt-auto">  {/* push impact card to bottom */}
       <GlassPanel className="p-4 mt-4">Monthly Sentry Mode Impact...</GlassPanel>
     </div>
   </GlassPanel>
   ```
3. Or if they're separate panels, ensure they're in a proper grid/flex column with gap

---

## Verification

```bash
cd web && npx tsc --noEmit

# Safety Settings page should show:
# 1. Live Safety Signals (4 cards: Driver Belt, Passenger Belt, Driver Seat, Vehicle Lock)
# 2. Driving Statistics (2 cards: Miles Since Reset, Self-Driving Miles)
# Both sections visible even when values are "—" or 0
```

**COMPLETION DEFINITION:**
- [ ] Live Safety Signals panel: 4 cards with color-coded values (green/red)
- [ ] Driving Statistics panel: 2 cards with miles values
- [ ] Data comes from vehicle live state (handle both snake_case and camelCase fields)
- [ ] Sections always render (show "—" when no data)
- [ ] Safety Score gauge + summary cards properly aligned (equal height, balanced widths)
- [ ] Drive Detail: tire pressure columns populated in drive_telemetry_readings (map TpmsFl/Fr/Rl/Rr)
- [ ] Sleep Efficiency: Monthly Sentry Mode Impact card not overlapping Sentry panel
- [ ] No inline styles, no direct recharts imports
- [ ] TypeScript compiles clean
