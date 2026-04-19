---
description: "Add quick glance widget view for at-a-glance vehicle status (battery, range, lock, location)"
---

# Quick Glance Widget View

## Problem

Checking battery level or lock status requires loading the full app, navigating
to the dashboard, and scanning for the vehicle card. For the most common use case
("What's my battery at?"), this is too much friction.

## Task

### Step 1: Create Glance Page

Create `web/src/features/dashboard/pages/GlancePage.tsx`:

A minimal, fast-loading page with just the essential vehicle status. Designed for
quick checks — tap notification, see battery, close.

**Layout:**
```
┌─────────────────────────────┐
│     Test Model Y            │
│     ● Online                │
│                             │
│        ╭──────╮             │
│        │  72% │  ← big      │
│        │  ██▓░│    battery   │
│        ╰──────╯    ring      │
│                             │
│    🔋 189 mi    🌡️ 24°C     │
│    🔒 Locked    📍 Home      │
│                             │
│  ┌────┐ ┌────┐ ┌────┐      │
│  │Lock│ │Clim│ │Horn│      │
│  └────┘ └────┘ └────┘      │
│                             │
│    Last updated: 30s ago    │
└─────────────────────────────┘
```

Components:
- Big circular battery gauge (RadialGauge from @/components/charts)
- 4 key metrics: range, temperature, lock status, location
- 3 quick action buttons: Lock/Unlock, Climate, Horn
- FreshnessIndicator (from prompt 07 or inline)
- No sidebar, no header — minimal chrome

```tsx
export default function GlancePage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const vehicle = vehicles?.[0]; // Primary vehicle
  // ... fetch state

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-6">
      {/* Vehicle name + status */}
      <h1 className="text-xl font-semibold text-white/90">{vehicle?.display_name}</h1>
      <Badge variant={isOnline ? 'success' : 'default'}>{vehicle?.state}</Badge>

      {/* Big battery ring */}
      <div className="my-8">
        <RadialGauge
          value={state?.battery_level ?? 0}
          max={100}
          size={180}
          label={`${state?.battery_level ?? 0}%`}
          color={batteryColor(state?.battery_level)}
        />
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-xs">
        <MetricTile icon={Battery} label={t('Range')} value={`${convertDistance(state?.rated_range ?? 0)} ${distanceUnit}`} />
        <MetricTile icon={Thermometer} label={t('Temp')} value={`${convertTemp(state?.inside_temp ?? 0)}${tempUnit}`} />
        <MetricTile icon={state?.is_locked ? Lock : Unlock} label={state?.is_locked ? t('Locked') : t('Unlocked')} />
        <MetricTile icon={MapPin} label={t('Location')} value={state?.location_name ?? '—'} />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mt-8">
        <QuickActionButton icon={Lock} label={t('Lock')} onClick={() => sendCmd('lock')} />
        <QuickActionButton icon={Wind} label={t('Climate')} onClick={() => sendCmd('climate_on')} />
        <QuickActionButton icon={Speaker} label={t('Horn')} onClick={() => sendCmd('honk_horn')} />
      </div>

      {/* Freshness */}
      <div className="mt-6">
        <FreshnessIndicator timestamp={state?.updated_at} />
      </div>

      {/* Link to full app */}
      <Link to="/" className="mt-4 text-xs text-white/30 hover:text-white/50">
        {t('glance.openApp', 'Open full app →')}
      </Link>
    </div>
  );
}
```

### Step 2: Add Route

```tsx
const GlancePage = lazy(() => import('./features/dashboard/pages/GlancePage'));
// Route: /glance
```

### Step 3: PWA Shortcut

Add a shortcut in the PWA manifest (vite.config.ts) so mobile users can add
"Glance" to their home screen:

```json
"shortcuts": [
  {
    "name": "Quick Glance",
    "url": "/glance",
    "icons": [{ "src": "/icons/icon-192x192.png", "sizes": "192x192" }]
  }
]
```

### Step 4: MetricTile and QuickActionButton

Create minimal helper components inside the glance page file or as separate files:

```tsx
function MetricTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value?: string }) {
  return (
    <GlassPanel className="p-3 flex items-center gap-3">
      <Icon className="h-4 w-4 text-white/40" />
      <div>
        <span className="text-[10px] text-white/40 block">{label}</span>
        {value && <span className="text-sm font-medium text-white/90">{value}</span>}
      </div>
    </GlassPanel>
  );
}

function QuickActionButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 p-3 rounded-xl bg-white/5 border border-white/[0.06]
        hover:bg-white/10 transition-colors min-w-[64px]"
    >
      <Icon className="h-5 w-5 text-[var(--theme-primary)]" />
      <span className="text-[10px] text-white/50">{label}</span>
    </button>
  );
}
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] /glance route loads a minimal full-screen view
- [ ] Battery gauge shows correct percentage with color
- [ ] Range, temp, lock, location display correctly
- [ ] Quick action buttons send commands
- [ ] "Open full app" link navigates to dashboard
- [ ] Page looks good on mobile (375px)
- [ ] No sidebar or navigation chrome on this page

## Commit

```bash
git add -A
git commit -m "feat(web): add quick glance page for at-a-glance vehicle status

- Create /glance route with minimal battery, range, lock, location display
- Add big RadialGauge for battery percentage
- Add 3 quick action buttons (Lock, Climate, Horn)
- Add PWA shortcut for home screen access
- No navigation chrome — designed for quick checks"
```
