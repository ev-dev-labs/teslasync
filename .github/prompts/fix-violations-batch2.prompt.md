# Fix Inline Styles, Raw HTML & camelCase Params — Batch 2

> **Context**: Post-rebuild audit found violations in 11 pages. Fix ALL items below.
> The rule: static `style={{ color: 'var(--text-primary)' }}` must become
> `className="text-[var(--text-primary)]"`. Dynamic styles (variables, props,
> CHART_COLORS[], computed values) are acceptable.

---

## Part 1 — Create shared Textarea component

DevToolsPage uses 9 raw `<textarea>` elements. Create a shared component first.

**Create** `web/src/components/ui/Textarea.tsx`:
```tsx
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div>
        {label && (
          <label htmlFor={textareaId} className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] px-3 py-2',
            'text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
            'focus:border-cyan-500/50 focus:outline-none focus:ring-1 focus:ring-cyan-500/30',
            'resize-y transition-colors',
            error && 'border-red-500/50',
            className,
          )}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
```

**Add to barrel** `web/src/components/ui/index.ts`:
```ts
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
```

---

## Part 2 — EnergyFlowPage.tsx (40 → target ≤15)

**File**: `web/src/features/battery/pages/EnergyFlowPage.tsx`

**19 static `var(--*)` inline styles** must become Tailwind classes:

```
style={{ color: 'var(--text-muted)' }}     → className="text-[var(--text-muted)]"
style={{ color: 'var(--text-secondary)' }} → className="text-[var(--text-secondary)]"
style={{ color: 'var(--text-primary)' }}   → className="text-[var(--text-primary)]"
```

Lines to fix: 143, 265, 275, 285, 382, 391, 409, 429, 437, 445, 453, 515, 563, 599,
629, 636, 650, 664, 685.

**Leave dynamic styles** (CHART_COLORS[N], computed values) untouched:
Lines 381, 390, 400, 408, 428, 430, 436, 438, 444, 446, 452, 454, 514, 562, 598,
628, 637, 651, 665, 684.

Also check line 151 — if it's a static `var(--*)`, convert it. If it's a
dynamic Sankey/animation style, leave it.

---

## Part 3 — TemperatureImpactPage.tsx (6 → 0)

**File**: `web/src/features/maps/pages/TemperatureImpactPage.tsx`

ALL 6 are static `var(--*)`:

| Line | Before | After |
|------|--------|-------|
| 249 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 303 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 347 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 350 | `style={{ color: 'var(--text-secondary)' }}` | `className="... text-[var(--text-secondary)]"` |
| 360 | `style={{ color: 'var(--text-muted)' }}` | `className="... text-[var(--text-muted)]"` |
| 394 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |

Remove the `style=` prop and merge the color class into existing `className`.

---

## Part 4 — StatisticsPage.tsx (6 → ≤1)

**File**: `web/src/features/analytics/pages/StatisticsPage.tsx`

5 static `var(--*)` inline styles:

| Line | Before | After |
|------|--------|-------|
| 183 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 199 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 229 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |
| 241 | `style={{ color: 'var(--text-secondary)' }}` | `className="... text-[var(--text-secondary)]"` |
| 245 | `style={{ color: 'var(--text-primary)' }}` | `className="... text-[var(--text-primary)]"` |

Line 219: `wrapperStyle={{ fontSize: 12 }}` — this is Recharts Legend API, leave as-is.

---

## Part 5 — NotificationsPage.tsx (6 → ≤2)

**File**: `web/src/features/notifications/pages/NotificationsPage.tsx`

2 static + 4 dynamic:

| Line | Type | Action |
|------|------|--------|
| 154 | Dynamic (conditional `ct.color` vs `var(--text-secondary)`) | LEAVE |
| 155 | Dynamic (conditional) | LEAVE |
| 266 | Dynamic (`m.color`) | LEAVE |
| 324 | Dynamic (`meta.color`) | LEAVE |
| 325 | Dynamic (`meta.color`) | LEAVE |
| 330 | Dynamic (`meta.color`) | LEAVE |

Actually ALL 6 are dynamic — no fixes needed. Verify and skip.

---

## Part 6 — WeeklyDigestPage.tsx (7 → ≤1)

**File**: `web/src/features/analytics/pages/WeeklyDigestPage.tsx`

| Line | Type | Action |
|------|------|--------|
| 267 | Dynamic (`color` variable) | LEAVE |
| 270 | Dynamic (`color` variable) | LEAVE |
| 277 | Dynamic (width + backgroundColor computed) | LEAVE |
| 911 | Static (`STATUS_COLORS.critical`) → actually dynamic from const | LEAVE |
| 917 | Static (`STATUS_COLORS.warning`) → dynamic from const | LEAVE |
| 923 | Dynamic (`CHART_COLORS[0]`) | LEAVE |
| 971 | Recharts `wrapperStyle` (library API) | LEAVE |

ALL are dynamic/library — no fixes needed. Verify and skip.

---

## Part 7 — SettingsPage.tsx (10 → ≤10)

**File**: `web/src/features/settings/pages/SettingsPage.tsx`

ALL 10 are dynamic (theme picker colors, computed boxShadow, conditional borderColor):
Lines 511, 515, 520, 526, 553, 557, 565, 581, 585, 593.

ALL acceptable — no fixes needed. Verify and skip.

---

## Part 8 — BatteryCellsPage.tsx (6 → ≤6)

**File**: `web/src/features/battery/pages/BatteryCellsPage.tsx`

| Line | Type | Action |
|------|------|--------|
| 142 | Dynamic (`gridTemplateColumns` computed from cols) | LEAVE |
| 151 | Dynamic (`backgroundColor` + `color` from cellColor() fn) | LEAVE |
| 161 | Static `backgroundColor: '#10b981'` | Convert to `className="bg-emerald-500"` |
| 165 | Static `backgroundColor: '#f59e0b'` | Convert to `className="bg-amber-500"` |
| 169 | Static `backgroundColor: '#ef4444'` | Convert to `className="bg-red-500"` |
| 241 | Dynamic (`color` from cellColor() fn) | LEAVE |

Fix lines 161, 165, 169 — legend dots with hardcoded hex colors.

---

## Part 9 — RoadmapPage.tsx (6 → ≤6)

**File**: `web/src/features/system/pages/RoadmapPage.tsx`

ALL 6 are dynamic (`phase.color`, `config.color`):
Lines 321, 326, 327, 381, 382, 406.

ALL acceptable — no fixes needed. Verify and skip.

---

## Part 10 — DriveDetailPage.tsx (8 → ≤8)

Already audited. ALL 8 are dynamic/library (LEGEND_STYLE, tp.color, item.color,
mapStyle, icon color prop). No fixes needed.

---

## Part 11 — DevToolsPage.tsx — Raw HTML + camelCase

**File**: `web/src/features/admin/pages/DevToolsPage.tsx`

### 11a: Replace 9 raw `<textarea>` with shared `<Textarea>`

Import the new component:
```tsx
import { Textarea } from '@/components/ui/Textarea';
```

Replace all `<textarea className={textareaClasses} ...>` with `<Textarea ...>`.
Remove the local `textareaClasses` const if no longer needed.

Lines: 608, 723, 1092, 1203, 1326, 1366, 1402, 1480, 1801.

### 11b: Fix 7 camelCase `vehicleId=` params

The backend expects `vehicle_id=` (snake_case). Fix these mutation URLs:

| Line | Wrong | Correct |
|------|-------|---------|
| 796 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 797 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 798 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 879 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 880 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 881 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |
| 882 | `vehicleId=${vehicleId}` | `vehicle_id=${vehicleId}` |

---

## Part 12 — ChargingListPage.tsx — Raw HTML

**File**: `web/src/features/charging/pages/ChargingListPage.tsx`

Replace 2 raw `<button>` elements (lines 715, 739) with the shared `<Button>` component.
Import from `@/components/ui/Button` if not already imported.

---

## Verification

```powershell
# 1. Inline styles — static var(--*) count across all pages
$pages = Get-ChildItem -Recurse web\src\features\*\pages\*.tsx
Select-String -Path $pages -Pattern "style=\{.*var\(--" | Measure-Object
# Target: significantly reduced from current count

# 2. Raw HTML
Select-String -Path $pages -Pattern '<button\b|<input\b|<table\b|<select\b|<textarea\b' -CaseSensitive | Measure-Object
# Target: 0 (or near 0)

# 3. camelCase params
Select-String -Path $pages -Pattern 'vehicleId=' | Measure-Object
# Target: 0

# 4. Textarea component exists
Test-Path web\src\components\ui\Textarea.tsx
# Must be True

# 5. TypeScript
cd web; npx tsc --noEmit
# Must pass clean
```

## Do NOT:
- Remove any existing page sections or functionality
- Use `git mv`
- Add new static inline styles
- Break existing dynamic styles that are acceptable
