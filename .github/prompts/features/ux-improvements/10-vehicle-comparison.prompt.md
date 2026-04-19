---
description: "Add vehicle comparison dashboard for side-by-side fleet metrics"
---

# Vehicle Comparison Dashboard

## Problem

Fleet owners with 2+ Tesla vehicles have no way to compare them side-by-side.
To compare battery degradation, efficiency, or costs between vehicles, they must
open each vehicle's page separately and mentally correlate the data.

## Task

### Step 1: Create Comparison Page

Create `web/src/features/analytics/pages/ComparisonPage.tsx`:

**Layout:**
```
┌──────────────────────────────────────────┐
│  Vehicle Comparison                      │
│  Compare your fleet side by side         │
│                                          │
│  [Vehicle 1 ▼]    vs    [Vehicle 2 ▼]   │
│                                          │
│  ┌─────────────┬─────────────┐          │
│  │  Model Y    │  Model 3    │          │
│  │  72% 🔋    │  85% 🔋    │          │
│  │  189 mi     │  245 mi     │          │
│  │  24°C       │  22°C       │          │
│  └─────────────┴─────────────┘          │
│                                          │
│  ── Efficiency (30d) ──────────────      │
│  [======= overlaid line chart =========] │
│                                          │
│  ── Battery Health ────────────────      │
│  [======= overlaid line chart =========] │
│                                          │
│  ── Stats Table ───────────────────      │
│  │ Metric        │ Model Y │ Model 3 │  │
│  │ Total Drives  │    124  │     89  │  │
│  │ Avg Efficiency│  245 Wh │  230 Wh │  │
│  │ Total Distance│ 3,200mi │ 2,100mi │  │
│  │ Total Cost    │  $86.40 │  $52.30 │  │
│  └───────────────┴─────────┴─────────┘  │
└──────────────────────────────────────────┘
```

### Step 2: Vehicle Selector

Two `Select` dropdowns at the top. When fleet has 2 vehicles, auto-populate both.
When fleet has 3+, let user pick which 2 to compare.

```tsx
const [vehicleA, setVehicleA] = useState<number | null>(null);
const [vehicleB, setVehicleB] = useState<number | null>(null);

// Auto-select first two vehicles
useEffect(() => {
  if (vehicles && vehicles.length >= 2) {
    if (!vehicleA) setVehicleA(vehicles[0].id);
    if (!vehicleB) setVehicleB(vehicles[1].id);
  }
}, [vehicles]);
```

### Step 3: Side-by-Side Status Cards

Show current state for both vehicles in a 2-column layout:

```tsx
<Grid cols={{ default: 1, md: 2 }} gap={4}>
  <VehicleStatusCard vehicle={vA} state={stateA} />
  <VehicleStatusCard vehicle={vB} state={stateB} />
</Grid>
```

Each card shows: battery %, range, temperature, lock status, last seen.

### Step 4: Overlaid Comparison Charts

Fetch analytics data for both vehicles and overlay on the same chart:

**Efficiency Chart (30 days):**
```tsx
<ChartContainer title={t('comparison.efficiency', 'Efficiency (Wh/mi)')} height={300} exportable>
  <ResponsiveContainer>
    <LineChart>
      <Line data={efficiencyA} stroke={CHART_COLORS[0]} name={vA.display_name} />
      <Line data={efficiencyB} stroke={CHART_COLORS[1]} name={vB.display_name} />
      <Legend />
    </LineChart>
  </ResponsiveContainer>
</ChartContainer>
```

**Battery Degradation Chart:**
- Overlay both vehicles' battery health trend on the same axes

**Charging Patterns:**
- Bar chart comparing average charge sessions per week

### Step 5: Comparison Stats Table

Use `DataTable` from `@/components/ui` for a structured comparison:

```tsx
const comparisonRows = [
  { metric: t('Total Drives'),   valueA: statsA?.total_drives,   valueB: statsB?.total_drives },
  { metric: t('Total Distance'), valueA: fmtDist(statsA?.total_distance), valueB: fmtDist(statsB?.total_distance) },
  { metric: t('Avg Efficiency'), valueA: `${statsA?.avg_efficiency} Wh/${distanceUnit}`, valueB: `${statsB?.avg_efficiency} Wh/${distanceUnit}` },
  { metric: t('Total Energy'),   valueA: `${statsA?.total_energy_kwh} kWh`, valueB: `${statsB?.total_energy_kwh} kWh` },
  { metric: t('Estimated Cost'), valueA: formatCost(statsA?.total_energy_kwh), valueB: formatCost(statsB?.total_energy_kwh) },
  { metric: t('Charge Sessions'),valueA: statsA?.total_charges,  valueB: statsB?.total_charges },
];
```

Highlight the "winner" in each row with a subtle green accent.

### Step 6: Add Route and Navigation

```tsx
// Route: /analytics/comparison
const ComparisonPage = lazy(() => import('./features/analytics/pages/ComparisonPage'));
```

Add to sidebar under ANALYTICS section:
- Icon: `GitCompare` from lucide-react
- Label: "Comparison"
- Only show if fleet has 2+ vehicles

### Step 7: Hooks

Use existing analytics hooks:
- `useAnalytics` for fleet stats
- `useVehicles` for vehicle list
- `useVehicleState` or equivalent for live state

If per-vehicle analytics aren't available from existing hooks, check what endpoints
exist in the router and create the necessary hooks.

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] Page loads with 2 vehicles auto-selected
- [ ] Vehicle selectors allow switching
- [ ] Side-by-side status cards show correct live data
- [ ] Overlaid charts show both vehicles with distinct colors
- [ ] Comparison table highlights the better value per row
- [ ] Navigation link hidden when fleet has only 1 vehicle
- [ ] Page responsive on mobile (stacked layout)

## Commit

```bash
git add -A
git commit -m "feat(web): add vehicle comparison dashboard for fleet analytics

- Create /analytics/comparison page with side-by-side layout
- Add overlaid efficiency and battery health charts
- Add comparison stats table with winner highlighting
- Auto-populate vehicle selectors for 2-vehicle fleets
- Only show nav link when fleet has 2+ vehicles"
```
