---
description: "Improve Vehicle Commands page UX: collapsible categories, merged toggles, favorites, danger styling"
---

# Improve Vehicle Commands Page UX

## Problem

The Vehicle Commands page (`web/src/features/system/pages/CommandsPage.tsx`, 841 lines)
displays 72 commands across 14 categories in a flat scrollable grid. Users must scroll
through the entire page to find a command. Several ON/OFF pairs are separate tiles
(Bioweapon ON + Bioweapon OFF = 2 tiles), making the page feel cluttered.

**No commands will be removed.** Every command must remain accessible. This is purely
a UX reorganization.

## Current State

```
web/src/features/system/pages/CommandsPage.tsx — 841 lines, 72 commands, 14 categories
```

### Current Problems
1. **72 tiles in a flat list** — too many to scan, must scroll through everything
2. **ON/OFF pairs as separate tiles** — Bioweapon, Climate Keeper, Overheat Protect each
   have 2-3 tiles for the same feature. Wastes space and creates confusion.
3. **No favorites** — users repeat the same 5-6 commands daily but must scroll to find them
4. **Categories have no visual separation** — just a tiny uppercase label, hard to scan
5. **Dangerous commands look the same** — Erase Data has the same tile style as Horn
6. **No search** — with 72 commands, finding a specific one requires scrolling

### What Already Works (keep these)
- Lock/Unlock toggle with state awareness ✅ (line 253)
- Sentry toggle with state awareness ✅ (line 254)
- Climate toggle with state + temp display ✅ (line 391)
- Charge toggle with state awareness ✅ (line 534)
- Live vehicle state refreshing every 15s ✅ (line 821)
- Command status tracking (✓/✗ time ago) ✅ (line 169)
- Toast notifications on success/failure ✅

## Task

### Step 1: Extract Command Data to Config

Currently all 72 commands are hardcoded inline as JSX. Extract them into a typed
command config array so the page can filter, sort, and group them dynamically.

Create `web/src/features/system/commands.ts`:

```typescript
import { LucideIcon, Power, Lock, Shield, ... } from 'lucide-react';

export interface CommandDef {
  id: string;                      // unique key: 'lock', 'bioweapon', 'horn', etc.
  command: string;                 // API command name: 'lock', 'bioweapon_on', etc.
  commandOff?: string;             // if toggle: API command for OFF state
  labelKey: string;                // i18n key: 'commands.security.lock'
  labelFallback: string;           // fallback English: 'Lock'
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: LucideIcon;
  category: CommandCategory;
  variant?: 'default' | 'danger' | 'success';
  type: 'action' | 'toggle' | 'input';  // action = fire once, toggle = ON/OFF, input = needs prompt
  stateField?: string;             // vehicle state field for toggle: 'is_locked', 'sentry_mode', etc.
  dangerous?: boolean;             // requires confirmation dialog
  requiresPin?: boolean;           // shows PIN prompt before executing
  inputConfig?: {                  // for 'input' type commands
    promptKey: string;
    promptFallback: string;
    paramName: string;
    validation?: (v: string) => boolean;
  };
  defaultFavorite?: boolean;       // pre-populated in favorites for new users
}

export type CommandCategory =
  | 'security'
  | 'climate'
  | 'climate_protection'
  | 'charging'
  | 'doors'
  | 'drive'
  | 'windows'
  | 'sunroof'
  | 'schedules'
  | 'alerts'
  | 'navigation'
  | 'software'
  | 'vehicle'
  | 'media';

export const CATEGORY_META: Record<CommandCategory, { labelKey: string; fallback: string; icon: LucideIcon }> = {
  security:           { labelKey: 'commands.cat.security',          fallback: 'Security & Access',    icon: Shield },
  climate:            { labelKey: 'commands.cat.climate',           fallback: 'Climate & Comfort',    icon: Wind },
  climate_protection: { labelKey: 'commands.cat.climateProtect',    fallback: 'Climate Protection',   icon: ShieldAlert },
  charging:           { labelKey: 'commands.cat.charging',          fallback: 'Charging',             icon: Zap },
  doors:              { labelKey: 'commands.cat.doors',             fallback: 'Doors & Trunk',        icon: DoorOpen },
  drive:              { labelKey: 'commands.cat.drive',             fallback: 'Drive',                icon: Car },
  windows:            { labelKey: 'commands.cat.windows',           fallback: 'Windows',              icon: Wind },
  sunroof:            { labelKey: 'commands.cat.sunroof',           fallback: 'Sunroof',              icon: ArrowUpFromDot },
  schedules:          { labelKey: 'commands.cat.schedules',         fallback: 'Schedules',            icon: CalendarPlus },
  alerts:             { labelKey: 'commands.cat.alerts',            fallback: 'Alerts & Location',    icon: Speaker },
  navigation:         { labelKey: 'commands.cat.navigation',        fallback: 'Navigation',           icon: Navigation },
  software:           { labelKey: 'commands.cat.software',          fallback: 'Software',             icon: Download },
  vehicle:            { labelKey: 'commands.cat.vehicle',           fallback: 'Vehicle',              icon: Car },
  media:              { labelKey: 'commands.cat.media',             fallback: 'Media',                icon: Play },
};

export const COMMANDS: CommandDef[] = [
  // ── Security & Access ──
  {
    id: 'wake_up', command: 'wake_up',
    labelKey: 'commands.security.wakeUp', labelFallback: 'Wake Up',
    icon: Power, category: 'security', type: 'action', variant: 'success',
    defaultFavorite: true,
  },
  {
    id: 'lock', command: 'lock', commandOff: 'unlock',
    labelKey: 'commands.security.lock', labelFallback: 'Lock',
    icon: Lock, category: 'security', type: 'toggle',
    stateField: 'is_locked', defaultFavorite: true,
  },
  {
    id: 'sentry', command: 'sentry_on', commandOff: 'sentry_off',
    labelKey: 'commands.security.sentry', labelFallback: 'Sentry',
    icon: Shield, category: 'security', type: 'toggle',
    stateField: 'sentry_mode', variant: 'danger', defaultFavorite: true,
  },
  // ... ALL 72 commands defined here — keep every single one
  // Port the exact command names, params, and behavior from the current JSX
];
```

**CRITICAL: Every one of the 72 current commands must appear in this array.**
Refer to the current page (lines 251-787) and port each `<CommandButton>` to a `CommandDef`.

### Merge ON/OFF Pairs into Toggles

Commands that are currently 2 separate tiles become 1 `CommandDef` with `type: 'toggle'`:

| Current Tiles | Merged Into |
|---|---|
| Bioweapon ON + Bioweapon OFF | 1 toggle `{ command: 'bioweapon_on', commandOff: 'bioweapon_off' }` |
| Climate Keeper ON + Climate Keeper OFF | 1 toggle |
| Guest Mode ON + Guest Mode OFF | 1 toggle |
| Valet Mode ON + Valet Off | 1 toggle |
| Start Charge + Stop Charge | 1 toggle (already done) |

Commands with 3+ variants (Overheat Protect: AC / Fan Only / OFF) stay as separate tiles
— these aren't simple on/off and need distinct buttons.

### Step 2: Favorites Row

Add a favorites bar at the top of each vehicle's command section. Favorites are stored
in localStorage per vehicle.

```typescript
// In the page component:
const FAVORITES_KEY = `teslasync-cmd-favorites-${vehicle.id}`;
const [favorites, setFavorites] = useState<string[]>(() => {
  const stored = localStorage.getItem(FAVORITES_KEY);
  if (stored) return JSON.parse(stored);
  // Default favorites for new users
  return COMMANDS.filter(c => c.defaultFavorite).map(c => c.id);
});

const toggleFavorite = (cmdId: string) => {
  setFavorites(prev => {
    const next = prev.includes(cmdId)
      ? prev.filter(id => id !== cmdId)
      : [...prev, cmdId];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    return next;
  });
};
```

Render a "Quick Actions" row at the top with the favorited commands:
```tsx
<CommandGroup title="commands.cat.quickActions" titleFallback="Quick Actions" t={t}>
  {COMMANDS.filter(c => favorites.includes(c.id)).map(cmd => (
    <CommandTile key={cmd.id} def={cmd} ... />
  ))}
</CommandGroup>
```

Add a small ⭐ icon button on each command tile to toggle favorite status.

Set these as `defaultFavorite: true`: Wake Up, Lock, Sentry, Climate, Frunk, Horn.

### Step 3: Collapsible Categories

Replace `CommandGroup` with a collapsible accordion pattern.

The page already has `Accordion` in `@/components/ui/`. If it fits, use it. Otherwise,
create a `CollapsibleCommandGroup` component:

```tsx
function CollapsibleCommandGroup({ category, children, t, defaultOpen = false }: {
  category: CommandCategory;
  children: React.ReactNode;
  t: TranslateFn;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-2 group"
      >
        <Icon className="h-4 w-4 text-white/40" />
        <span className="text-xs uppercase tracking-wider text-white/50 font-medium">
          {t(meta.labelKey, meta.fallback)}
        </span>
        <span className="text-[10px] text-white/30 ml-1">
          ({React.Children.count(children)})
        </span>
        <ChevronDown className={cn(
          "h-3.5 w-3.5 text-white/30 ml-auto transition-transform",
          open && "rotate-180"
        )} />
      </button>
      {open && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-2">
          {children}
        </div>
      )}
    </div>
  );
}
```

**Default open:** "Quick Actions" (favorites) is always open. All other categories
start collapsed. The first category with a command-in-progress should auto-open.

Store open/closed state in sessionStorage so it persists during the session but
not across browser restarts.

### Step 4: Command Search/Filter

Add a search input below the vehicle header that filters commands by name:

```tsx
const [search, setSearch] = useState('');
const filteredCommands = useMemo(() => {
  if (!search.trim()) return COMMANDS;
  const q = search.toLowerCase();
  return COMMANDS.filter(c =>
    t(c.labelKey, c.labelFallback).toLowerCase().includes(q) ||
    c.category.includes(q)
  );
}, [search, t]);
```

When search is active, show all matching commands in a flat grid (no categories).
When search is empty, show the normal category view.

Use the shared `Input` component from `@/components/ui`.

### Step 5: Danger Command Styling

Commands with `dangerous: true` should have distinct visual treatment:

```tsx
// In CommandButton, add danger border + confirmation icon
{def.dangerous && (
  <div className="absolute top-1.5 right-1.5">
    <AlertTriangle className="h-3 w-3 text-neon-red/50" />
  </div>
)}
```

Mark these as `dangerous: true` in the command config:
- Erase Data
- Remote Start Drive
- Clear PIN Admin variants

### Step 6: Toggle Tile Component

Create a `ToggleCommandTile` that renders a single tile with ON/OFF states:

```tsx
function ToggleCommandTile({ def, state, onExecute, loading, lastStatus }: {
  def: CommandDef;
  state: VehicleState | null;
  onExecute: (command: string, params?: Record<string, string>) => void;
  loading: boolean;
  lastStatus?: string;
}) {
  const isOn = def.stateField && state ? Boolean((state as any)[def.stateField]) : false;
  const Icon = def.icon;

  return (
    <GlassPanel
      className={cn(
        'p-4 flex flex-col items-center gap-2 transition-all duration-300 text-center min-h-[100px] justify-center cursor-pointer relative',
        isOn ? 'border-neon-green/20 bg-neon-green/5' : 'hover:border-white/10',
        loading && 'opacity-50',
      )}
      onClick={() => {
        if (loading) return;
        onExecute(isOn ? def.commandOff! : def.command);
      }}
    >
      {/* State indicator dot */}
      <div className={cn(
        'absolute top-2 right-2 h-2 w-2 rounded-full',
        isOn ? 'bg-neon-green' : 'bg-white/10'
      )} />

      <div className={cn('rounded-xl p-2.5', isOn ? 'bg-neon-green/20 text-neon-green' : 'bg-white/5 text-white/40')}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-xs font-medium text-white/90">{t(def.labelKey, def.labelFallback)}</span>
      <span className={cn('text-[10px] font-medium', isOn ? 'text-neon-green' : 'text-white/40')}>
        {isOn ? t('ON') : t('OFF')}
      </span>
    </GlassPanel>
  );
}
```

### Step 7: Decompose the Page

The current page is 841 lines. After this refactoring, split into:

```
web/src/features/system/
  commands.ts                    — CommandDef[], CATEGORY_META, types
  pages/CommandsPage.tsx         — Main page orchestration (vehicle list, stats)
  components/
    CommandTile.tsx               — Single action command tile
    ToggleCommandTile.tsx         — Toggle ON/OFF command tile
    InputCommandTile.tsx          — Command with prompt input
    CollapsibleCommandGroup.tsx   — Accordion category group
    CommandSearch.tsx             — Search/filter input
    FavoritesBar.tsx              — Quick actions favorites row
    VehicleCommandCenter.tsx      — Per-vehicle command section
```

Each component file should export one component. `CommandsPage.tsx` should be
the orchestrator that composes these components.

## Verification

```bash
cd web && npx tsc --noEmit
```

### Manual Verification Checklist
- [ ] All 72 commands are still accessible (count tiles + toggle states)
- [ ] Favorites row shows default favorites on first visit
- [ ] Adding/removing favorites persists across page refreshes
- [ ] All categories are collapsible and expand correctly
- [ ] Search filters commands by name
- [ ] Toggle tiles show correct ON/OFF state from vehicle state
- [ ] Dangerous commands show warning icon and confirmation dialog
- [ ] Lock/Unlock, Sentry, Climate toggles still work with live state
- [ ] Command execution still shows toast + status tracking
- [ ] Page is responsive: 2 cols mobile, 3 tablet, 4 desktop

## Commit

After all verification passes, commit the changes:

```bash
git add -A
git commit -m "refactor(web): improve Commands page UX with collapsible categories and toggles

- Extract 72 commands into typed config array (commands.ts)
- Merge ON/OFF pairs into single toggle tiles with state indicators
- Add favorites/quick actions row with localStorage persistence
- Add collapsible accordion categories (collapsed by default)
- Add command search/filter
- Add danger styling for destructive commands
- Decompose 841-line monolith into 8 focused components
- Zero commands removed — all 72 remain accessible"
```

## What NOT To Change

- Do not remove any commands — every one of the 72 must remain accessible
- Do not change the API endpoints or command names
- Do not change the mutation/query logic — keep the same React Query patterns
- Do not change the vehicle state polling interval (15s)
- Do not change the command status tracking (latest command log)
- Do not modify the backend (Go handlers, router, etc.)
