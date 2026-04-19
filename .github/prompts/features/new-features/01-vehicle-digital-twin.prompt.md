---
description: "Vehicle Digital Twin: 2D interactive car visual showing real-time door, window, trunk, charge port state"
---

# Vehicle Digital Twin

## Problem

TeslaSync receives detailed vehicle physical state signals (doors open/closed,
windows up/down/vented, trunk/frunk, charge port, lights) but displays them as
text fields in tables. Users want a **visual representation** of their car showing
these states at a glance — like the Tesla app's car visualization.

## Current State

### Backend Data Available (internal/models/models.go:886-917)
The `SecurityEvent` struct has all the physical state signals:
```go
DoorState              *string  // compound JSON: {"DriverFront": true, ...}
FdWindow               *string  // "WindowStateOpen", "WindowStateClosed", "WindowStatePartiallyOpen"
FpWindow               *string
RdWindow               *string
RpWindow               *string
Locked                 *bool
SentryMode             *bool
ChargePortDoorOpen     *bool    // from types.ts — needs to be added to SecurityEvent if missing
LightsHazardsActive    *bool
LightsHighBeams        *bool
LightsTurnSignal       *string  // "TurnSignalLeft", "TurnSignalRight", "TurnSignalBoth", "TurnSignalOff"
DriverSeatOccupied     *bool
TonneauPosition        *string
TonneauOpenPercent     *float64
```

### Frontend Gap
`VehicleState` interface (web/src/api/types.ts:273-294) is **minimal** — only has
`is_locked`, `sentry_mode`, battery, temps. The detailed physical state is in
`SecurityEvent` (types.ts:594-624) fetched via `useSecurityLatest()`.

### Existing Pages
- `SecurityAccessPage.tsx` (966 lines) shows door/window state as **text badges**
- No visual car representation anywhere

## Task

### Step 1: Create Vehicle SVG Component

Create `web/src/components/vehicles/VehicleTwin.tsx`:

A top-down 2D SVG view of a Tesla showing real-time component states.
The SVG should be clean, minimal, and match the glassmorphic design language.

```tsx
interface VehicleTwinProps {
  // Door states (true = open)
  doorDriverFront?: boolean;
  doorPassengerFront?: boolean;
  doorDriverRear?: boolean;
  doorPassengerRear?: boolean;

  // Window states
  windowFD?: 'open' | 'closed' | 'partial' | null;
  windowFP?: 'open' | 'closed' | 'partial' | null;
  windowRD?: 'open' | 'closed' | 'partial' | null;
  windowRP?: 'open' | 'closed' | 'partial' | null;

  // Trunk/Frunk
  frunkOpen?: boolean;
  trunkOpen?: boolean;

  // Charge port
  chargePortOpen?: boolean;
  isCharging?: boolean;

  // Security
  locked?: boolean;
  sentryMode?: boolean;

  // Lights
  headlights?: boolean;
  hazards?: boolean;
  turnSignal?: 'left' | 'right' | 'both' | 'off' | null;

  // Occupancy
  driverSeatOccupied?: boolean;

  // Meta
  vehicleColor?: string;  // exterior color for accent
  className?: string;
  size?: 'sm' | 'md' | 'lg';  // sm=200px, md=320px, lg=480px
  interactive?: boolean;       // show tooltips on hover
}
```

### SVG Design Spec

**Top-down view of a Tesla sedan/SUV:**

```
         ┌─────────┐
         │  FRUNK   │  ← opens upward when frunkOpen
    ┌────┤         ├────┐
    │ HL │         │ HL │  ← headlights glow when on
    ├────┘         └────┤
    │                    │
    │DF              PF │  ← door lines swing open
    │  ┌──┐      ┌──┐  │  ← windows colored by state
    │  │WF│      │WF│  │
    │  └──┘      └──┘  │
    │                    │
    │DR              PR │
    │  ┌──┐      ┌──┐  │
    │  │WR│      │WR│  │
    │  └──┘      └──┘  │
    │                    │
    ├────┐         ┌────┤
    │ TL │  TRUNK  │ TL │  ← tail lights
    └────┤         ├────┘
         │  ○ CP   │  ← charge port indicator
         └─────────┘
```

**Color coding:**
- Body: `fill: var(--surface-2)` with `stroke: var(--glass-border)`
- Closed door: body color (no highlight)
- Open door: door line swings outward + neon amber highlight
- Window closed: `fill: rgba(255,255,255,0.05)` (tinted glass)
- Window open: transparent (no fill — shows background through)
- Window partial: half-height fill
- Frunk/trunk open: lifted position + neon amber fill
- Charge port closed: small circle, body color
- Charge port open: neon green ring
- Charging active: neon green pulsing glow on charge port
- Locked: small lock icon overlay (neon green)
- Unlocked: small unlock icon (neon red)
- Sentry active: shield icon with red glow
- Headlights on: white/cyan glow beams from front
- Hazards: amber pulse on all four corners
- Turn signal: amber pulse on left or right side
- Driver seat occupied: subtle highlight on driver seat area

**Implementation approach:**
- Use inline SVG (not an image file) so colors can be dynamic
- Use CSS transitions for smooth state changes (door opening animation)
- Use CSS animations for pulsing effects (charging, hazards)
- Keep SVG paths simple — this is a schematic, not a photo-realistic render
- Use `currentColor` and CSS custom properties for theme compatibility

### Step 2: Parse DoorState Compound Signal

The `DoorState` signal is a compound type (`TypeDoors`). Create a parser:

```tsx
// web/src/lib/vehicleState.ts

interface DoorStates {
  driverFront: boolean;
  passengerFront: boolean;
  driverRear: boolean;
  passengerRear: boolean;
}

function parseDoorState(doorState: string | null | undefined): DoorStates {
  if (!doorState) return { driverFront: false, passengerFront: false, driverRear: false, passengerRear: false };

  // DoorState may be a JSON string like: {"DriverFront":true,"PassengerFront":false,...}
  // Or a compound string from Fleet Telemetry
  try {
    const parsed = JSON.parse(doorState);
    return {
      driverFront: Boolean(parsed.DriverFront ?? parsed.driver_front),
      passengerFront: Boolean(parsed.PassengerFront ?? parsed.passenger_front),
      driverRear: Boolean(parsed.DriverRear ?? parsed.driver_rear),
      passengerRear: Boolean(parsed.PassengerRear ?? parsed.passenger_rear),
    };
  } catch {
    return { driverFront: false, passengerFront: false, driverRear: false, passengerRear: false };
  }
}

function parseWindowState(state: string | null | undefined): 'open' | 'closed' | 'partial' | null {
  if (!state) return null;
  const lower = state.toLowerCase();
  if (lower.includes('open') && !lower.includes('partial')) return 'open';
  if (lower.includes('partial')) return 'partial';
  if (lower.includes('closed')) return 'closed';
  return null;
}
```

### Step 3: Create Digital Twin Page

Create `web/src/features/vehicles/pages/DigitalTwinPage.tsx`:

A full page focused on the vehicle visualization:

```tsx
export default function DigitalTwinPage() {
  const { t } = useTranslation();
  usePageTitle(t('digitalTwin.title', 'Digital Twin'));

  const { data: vehicles } = useVehicles();
  const vehicle = vehicles?.[0];
  const { data: securityData } = useSecurityLatest(vehicle?.id ?? 0, 5_000); // 5s refresh

  const doors = parseDoorState(securityData?.door_state);
  const state = mapSecurityToTwinProps(securityData);

  return (
    <PageContainer title={t('digitalTwin.title')} subtitle={t('digitalTwin.subtitle', 'Real-time vehicle state')}>
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Main visualization */}
        <FadeIn className="flex-1 flex items-center justify-center">
          <GlassPanel className="p-8">
            <VehicleTwin {...state} size="lg" interactive />
          </GlassPanel>
        </FadeIn>

        {/* Side panel — text detail */}
        <div className="w-full lg:w-80 space-y-4">
          <GlassPanel className="p-4">
            <h3>{t('digitalTwin.doors', 'Doors')}</h3>
            <KVList items={[
              { key: t('Driver Front'), value: doors.driverFront ? t('Open') : t('Closed') },
              { key: t('Passenger Front'), value: doors.passengerFront ? t('Open') : t('Closed') },
              // ...
            ]} />
          </GlassPanel>

          <GlassPanel className="p-4">
            <h3>{t('digitalTwin.windows', 'Windows')}</h3>
            {/* Window states */}
          </GlassPanel>

          <GlassPanel className="p-4">
            <h3>{t('digitalTwin.security', 'Security')}</h3>
            {/* Lock, sentry, occupancy */}
          </GlassPanel>
        </div>
      </div>
    </PageContainer>
  );
}
```

### Step 4: Embed in Existing Pages

Add the `VehicleTwin` component (small size) to:

1. **Dashboard** — in the vehicle hero card area, replace or complement the text status
2. **SecurityAccessPage** — add visual alongside the existing text badges
3. **Vehicle Detail Page** — add as a section

```tsx
// Small inline twin on dashboard:
<VehicleTwin {...state} size="sm" />
```

### Step 5: Add Route

```tsx
const DigitalTwinPage = lazy(() => import('./features/vehicles/pages/DigitalTwinPage'));
// Route: /vehicles/:id/twin or /digital-twin
```

Add to sidebar under VEHICLES section with icon `Monitor` from lucide-react.

### Step 6: Live Updates

The `useSecurityLatest` hook already refetches every 15s. For the Digital Twin page,
reduce to **5 seconds** for near-real-time updates:

```tsx
const { data: securityData } = useSecurityLatest(vehicleId, 5_000);
```

### Step 7: Animations

Use Framer Motion (already available via `@/components/motion`) for:
- Door swing animation when opening/closing (rotate transform)
- Charge port glow pulse when charging
- Hazard flash animation (opacity toggle on 500ms interval)
- Smooth transitions between all states

```tsx
<motion.path
  d={doorPath}
  animate={{ rotate: doorOpen ? -45 : 0 }}
  transition={{ duration: 0.3, ease: 'easeInOut' }}
  transformOrigin="left center"
/>
```

## Verification

```bash
cd web && npx tsc --noEmit
```

- [ ] SVG renders correctly at all 3 sizes (sm, md, lg)
- [ ] All door states visually distinct (open/closed)
- [ ] All window states visually distinct (open/closed/partial)
- [ ] Charge port shows green when charging, neutral when closed
- [ ] Lock/unlock indicator visible
- [ ] Sentry mode indicator visible
- [ ] Headlights/hazards animate correctly
- [ ] Component is responsive on mobile
- [ ] Tooltips show on hover when `interactive` is true
- [ ] Dark theme compatible (uses CSS variables)

## Commit

```bash
git add -A
git commit -m "feat(web): add Vehicle Digital Twin with real-time state visualization

- Create VehicleTwin SVG component with door, window, trunk, charge port states
- Parse DoorState compound signal and window enum values
- Create dedicated DigitalTwinPage with detail side panel
- Embed small twin on dashboard and security pages
- Animate state changes with Framer Motion
- 5-second refresh for near-real-time updates
- Support all 3 sizes (sm/md/lg) for different contexts"
```
