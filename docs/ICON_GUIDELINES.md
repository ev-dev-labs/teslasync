# Iconography Guidelines

TeslaSync uses [`lucide-react`](https://lucide.dev) as its icon library, but
**all icon usage must go through the central registry** at
[`web/src/lib/icons.ts`](../web/src/lib/icons.ts). This keeps the same concept
rendered with the same icon everywhere (no Battery vs BatteryCharging vs Zap
inconsistency for the "battery" concept), and keeps icon sizing consistent
across the app.

## Quick start

```tsx
import { Icon } from '@/components/ui';
import { Icons } from '@/lib/icons';

<Button>
  <Icon icon={Icons.add} /> {t('common.addRule', 'Add rule')}
</Button>

<Icon icon={Icons.battery} size="lg" className="text-emerald-300" />
```

## Rules

### 1. Always import from the registry

```ts
// ❌ BAD — bypasses the canonical mapping
import { Battery, Zap } from 'lucide-react';

// ✅ GOOD — concept-routed
import { Icons } from '@/lib/icons';
//   <Icons.battery />       — bare React component
//   <Icon icon={Icons.battery} size="lg" />   — wrapper with sizing
```

### 2. Use the `<Icon>` wrapper for sizing

The `<Icon>` component from `@/components/ui` enforces the standard size
tokens and adds `shrink-0` so icons never get squeezed inside flex containers.

| Token | Tailwind   | Use for                                  |
| ----- | ---------- | ---------------------------------------- |
| `xs`  | `h-3 w-3`  | Inline indicators, tiny status dots      |
| `sm`  | `h-3.5 w-3.5` | Compact badges, table cells           |
| `md`  | `h-4 w-4`  | **Default.** Buttons, inline labels      |
| `lg`  | `h-5 w-5`  | Section headers, panel icons             |
| `xl`  | `h-6 w-6`  | Hero/feature icons                       |

```tsx
// ❌ BAD — ad hoc size, no shrink-0
<Battery className="h-5 w-5" />

// ✅ GOOD
<Icon icon={Icons.battery} size="lg" />
```

### 3. Use the canonical concept, not the lucide name

The registry collapses overlapping lucide icons onto a single canonical
choice for each concept:

| Concept                | Icon            |
| ---------------------- | --------------- |
| `Icons.battery`        | `Battery`       |
| `Icons.batteryCharging`| `BatteryCharging` |
| `Icons.charging`       | `Zap`           |
| `Icons.charger`        | `Plug`          |
| `Icons.severityCritical` | `AlertOctagon` |
| `Icons.severityWarn`   | `AlertTriangle` |
| `Icons.severityInfo`   | `Info`          |
| `Icons.success`        | `CheckCircle`   |
| `Icons.error`          | `XCircle`       |
| `Icons.add`            | `Plus`          |
| `Icons.delete`         | `Trash2`        |
| `Icons.edit`           | `Edit3`         |
| `Icons.refresh`        | `RefreshCw`     |
| `Icons.settings`       | `Settings`      |
| `Icons.preferences`    | `SlidersHorizontal` |

If a concept isn't in the registry, **add it** rather than reaching back into
`lucide-react`. New entries should pick the most semantic name available
(prefer `vehicle` over `car`, `notifications` over `bell`).

### 4. Accessibility

- Decorative icons (the common case) need no extra props — the `<Icon>` wrapper
  emits `aria-hidden="true"` by default.
- Meaningful icons need an explicit label:
  ```tsx
  <Icon icon={Icons.success} aria-label={t('common.complete', 'Complete')} />
  ```
  When `aria-label` is set, the wrapper emits `role="img"` so screen readers
  announce it.

## Allowed direct `lucide-react` imports

Only these files may import directly from `lucide-react`:

| File                       | Why                                           |
| -------------------------- | --------------------------------------------- |
| `web/src/lib/icons.ts`     | The registry itself                           |
| `web/src/components/ui/Icon.tsx` | Re-exports `LucideIcon` for prop typing |

Branded SVGs (Tesla logo, app logo, marketing assets) belong under
`web/public/` or `web/src/components/ui/Logo.tsx` — keep them out of both
the registry and direct lucide imports.

## Auditing

### Bundle constraint (CLEAN-08 — the old audit was archived)

`scripts/icon-audit.ps1` and its reports (`docs/audits/icon-audit.md`,
`docs/audits/lucide-direct-imports.txt`) counted "files importing directly from
`lucide-react`" and treated that number as debt. **That premise inverted** and
the audit is archived under
[`docs/audits/archive/`](audits/archive/README.md).

The registry exists for *concept consistency*, not for bundling: a central icon
module is not tree-shakeable, so every importer of it reaches every icon it
names. If such a module ever lands in the cold-start closure, ~400 icon modules
are downloaded before first paint — the same failure that force-grouping
`lucide-react` in Vite's `manualChunks` produced (`vendor-icons`, since
removed). Per-route direct imports are what let Rollup place an icon in the
chunk of the route that renders it.

The property is now enforced by executable gates instead of a report:

| Property | Gate |
| --- | --- |
| Icons must not be hoisted into the startup closure | `npm run perf:check` → `check-bundle-size.mjs --strict` (`BUNDLE_STARTUP_ICON_SHARE_LIMIT`, measured from production source maps) |
| `manualChunks` must not force-group `lucide-react` | `web/src/__tests__/viteChunking.test.ts` |

Startup icon locality is owned entirely by `check-bundle-size.mjs`.
`check-duplicate-modules.mjs` checks a different property — that a package
reaches the bundle through a single physical copy — and does not enforce icon
locality.

Prefer the registry for concept routing, but **never** add a barrel or wrapper
that makes a shell module reach the whole registry.

## Migrating a file

1. Find the lucide import block:
   ```ts
   import { Battery, Zap, Settings } from 'lucide-react';
   ```
2. Replace with the registry import:
   ```ts
   import { Icon } from '@/components/ui';
   import { Icons } from '@/lib/icons';
   ```
3. Swap each usage:
   ```diff
   - <Battery className="h-5 w-5 text-emerald-400" />
   + <Icon icon={Icons.battery} size="lg" className="text-emerald-400" />
   ```
4. For data references (e.g. `icon: LucideIcon` in a config object), use
   `Icons.x` directly without the wrapper:
   ```diff
   - { id: 'lock', icon: Lock, label: 'Lock' }
   + { id: 'lock', icon: Icons.locked, label: 'Lock' }
   ```
5. Confirm the change with a source-map-attributed build rather than the
   archived `icon-audit.ps1` report:
   ```bash
   cd web
   VITE_SOURCEMAP_MODE=private npm run build   # hidden, CI-only maps
   npm run perf:check                          # startup icon + feature locality
   find dist -name '*.map' -delete             # never publish the maps
   ```
