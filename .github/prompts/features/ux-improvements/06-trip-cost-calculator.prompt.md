---
description: "Add trip cost calculation to drive detail page using the existing cost/kWh setting"
---

# Trip Cost Calculator

## Problem

The Driving pages show distance, duration, and energy consumed — but not the
electricity cost. Users have to manually calculate cost from kWh × rate.
The Settings page already has a `base_cost_per_kwh` setting (default $0.12)
that's unused by the driving features.

## Current State

```
web/src/features/settings/pages/SettingsPage.tsx:590-601 — base_cost_per_kwh setting
web/src/hooks/useSettings.ts — exposes settings but doesn't compute trip costs
```

The drive detail data already includes `energy_used` (kWh) from the API.

## Task

### Step 1: Add Cost Formatter to useSettings

In `web/src/hooks/useSettings.ts`, add a `formatCost` and `tripCost` helper:

```typescript
// In useSettings return value:
const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
const currencySymbol = '$'; // TODO: could be configurable later

const formatCost = (kwh: number) => {
  const cost = kwh * costPerKwh;
  return `${currencySymbol}${cost.toFixed(2)}`;
};

const costPerDistance = (kwh: number, distanceKm: number) => {
  if (distanceKm <= 0) return null;
  const cost = kwh * costPerKwh;
  // Cost per mile or km depending on user setting
  const dist = convertDistance(distanceKm);
  return cost / dist;
};

return {
  // ... existing
  costPerKwh,
  formatCost,
  costPerDistance,
};
```

### Step 2: Add Cost to Drive Detail Page

In the drive detail page (likely `web/src/features/driving/pages/DriveDetailPage.tsx`),
add cost metrics:

**In the stats row:**
```tsx
<StatCard
  label={t('drive.cost', 'Trip Cost')}
  value={drive.energy_used != null ? formatCost(drive.energy_used) : '—'}
  icon={<DollarSign className="h-4 w-4" />}
/>
<StatCard
  label={t('drive.costPerMile', `Cost / ${distanceUnit}`)}
  value={drive.energy_used != null && drive.distance != null
    ? `${currencySymbol}${costPerDistance(drive.energy_used, drive.distance)?.toFixed(3) ?? '—'}`
    : '—'}
  icon={<TrendingDown className="h-4 w-4" />}
/>
```

### Step 3: Add Cost to Driving List Page

In the drive list/summary view, add a subtle cost column or inline metric
next to each drive entry:

```tsx
<span className="text-xs text-white/40">
  {drive.energy_used != null ? formatCost(drive.energy_used) : ''}
</span>
```

### Step 4: Add Cost to Charging Sessions

The charging detail page shows energy added (kWh). Add cost for home charging
sessions (where user's rate applies):

```tsx
<StatCard
  label={t('charge.cost', 'Estimated Cost')}
  value={session.energy_added != null ? formatCost(session.energy_added) : '—'}
  sublabel={t('charge.atRate', `at ${currencySymbol}${costPerKwh}/kWh`)}
/>
```

### Step 5: Add Gas Savings Comparison

The settings already have `comparison_vehicle_mpg` and `gas_price_per_unit`.
Add a "vs Gas" comparison on the drive detail page:

```tsx
const gasCost = drive.distance != null
  ? (convertDistance(drive.distance) / settings.comparison_vehicle_mpg) * settings.gas_price_per_unit
  : null;
const savings = gasCost != null && drive.energy_used != null
  ? gasCost - (drive.energy_used * costPerKwh)
  : null;

{savings != null && savings > 0 && (
  <StatCard
    label={t('drive.gasSavings', 'vs Gas Savings')}
    value={`${currencySymbol}${savings.toFixed(2)}`}
    variant="success"
    icon={<Leaf className="h-4 w-4" />}
  />
)}
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Drive detail shows trip cost based on energy_used × cost_per_kwh
- [ ] Drive detail shows cost per mile/km
- [ ] Drive list shows cost per trip
- [ ] Charging page shows estimated cost
- [ ] Gas savings comparison shows when comparison vehicle is configured
- [ ] Cost displays "—" when energy_used is null (no data)
- [ ] Changing cost/kWh in Settings updates calculations on next page load

## Commit

```bash
git add -A
git commit -m "feat(web): add trip cost calculation and gas savings comparison

- Add formatCost and costPerDistance helpers to useSettings
- Show trip cost and cost/mile on drive detail page
- Show cost per trip in drive list
- Show estimated charging cost on charge detail page
- Add gas savings comparison using comparison vehicle MPG setting"
```
