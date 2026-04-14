---
description: "Fix Safety Settings — add Live Safety Signals + Driving Statistics panels"
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
- [ ] No inline styles, no direct recharts imports
- [ ] TypeScript compiles clean
