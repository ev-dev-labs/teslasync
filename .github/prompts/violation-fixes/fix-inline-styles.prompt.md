# Fix Static Inline Styles — Replace `var(--*)` with Tailwind Classes

## Rule: `static-inline-style`

Inline `style={{}}` attributes using static CSS custom properties (`var(--*)`) must be replaced with Tailwind utility classes. Dynamic values (ternary expressions, computed values, array-indexed colors) are allowed to remain as `style={{}}`.

## Tailwind Mapping Reference

| CSS Variable | Tailwind Class |
|---|---|
| `color: 'var(--text-primary)'` | `text-white/90` |
| `color: 'var(--text-secondary)'` | `text-white/60` |
| `color: 'var(--text-muted)'` | `text-white/40` |
| `background: 'var(--surface-2)'` | `bg-white/[0.03]` |
| `background: 'var(--surface-1)'` | `bg-white/[0.04]` |
| `background: 'var(--glass-bg)'` | `bg-white/[0.04]` |
| `borderColor: 'var(--glass-border)'` | `border-white/[0.06]` |
| `border: '1px solid var(--glass-border)'` | `border border-white/[0.06]` |
| `borderBottom: '1px solid var(--glass-border)'` | `border-b border-white/[0.06]` |
| `color: 'var(--accent)'` | `text-cyan-400` |
| `color: 'var(--danger)'` | `text-red-400` |
| `color: 'var(--success)'` | `text-emerald-400` |
| `color: 'var(--warning)'` | `text-amber-400` |

## Conversion Rules

1. **Read the actual line** before converting — understand what element it is and what other classes exist.
2. If the `style={{}}` contains ONLY static `var(--*)` values, remove the entire `style` attribute and merge the Tailwind equivalents into the existing `className`.
3. If the `style={{}}` contains a MIX of static `var(--*)` and dynamic values, remove only the static properties and keep the `style` attribute with the remaining dynamic properties.
4. If an element has NO existing `className`, add one.
5. Use the `cn()` helper from `@/lib/cn` if conditional class merging is needed (replaces `clsx`).
6. For `boxShadow` with static rgba values, you may keep as `style={{}}` since Tailwind shadow utilities are limited — or use `shadow-xl` / `shadow-2xl` if close enough.
7. For `color: 'var(--text-primary, #fff)'` (with fallback), still convert — the fallback is only for graceful degradation.

## Files to Fix (25 violations)

### 1. `web/src/components/charts/ChartTooltip.tsx`

**Line 16-18** — Container div background/border:
```tsx
// BEFORE (lines 15-19):
style={{
  background: 'var(--surface-2)',
  borderColor: 'var(--glass-border)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
}}
// AFTER: Move background and borderColor to className, keep boxShadow in style
// className="rounded-xl border px-4 py-3 text-xs shadow-xl backdrop-blur-xl bg-white/[0.03] border-white/[0.06]"
// style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
```

**Line 21** — Label paragraph color:
```tsx
// BEFORE:
<p className="mb-1.5 font-medium" style={{ color: 'var(--text-secondary)' }}>
// AFTER:
<p className="mb-1.5 font-medium text-white/60">
```

**Line 28** — Name span color:
```tsx
// BEFORE:
<span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
// AFTER:
<span className="text-white/60">{p.name}:</span>
```

**Line 29** — Value span color:
```tsx
// BEFORE:
<span className="font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
// AFTER:
<span className="font-mono font-semibold text-white/90">
```

### 2. `web/src/components/data-display/InsightsEngine.tsx`

**Line 366** — Section title color:
```tsx
// BEFORE:
<h3 className="section-title flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
// AFTER:
<h3 className="section-title flex items-center gap-2 text-white/90">
```

**Line 400** — Insight title color:
```tsx
// BEFORE:
<span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
// AFTER:
<span className="text-sm font-semibold text-white/90">
```

**Line 408** — Insight description color:
```tsx
// BEFORE:
<p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
// AFTER:
<p className="text-xs leading-relaxed text-white/60">
```

### 3. `web/src/components/feedback/InstallPrompt.tsx`

**Line 75** — Title color (with fallback):
```tsx
// BEFORE:
<p className="text-sm font-semibold leading-tight" style={{ color: 'var(--text-primary, #fff)' }}>
// AFTER:
<p className="text-sm font-semibold leading-tight text-white/90">
```

**Line 78** — Subtitle color (with fallback):
```tsx
// BEFORE:
<p className="text-xs leading-tight mt-0.5" style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }}>
// AFTER:
<p className="text-xs leading-tight mt-0.5 text-white/40">
```

**Line 94** — X icon color (with fallback):
```tsx
// BEFORE:
<X className="h-4 w-4" style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }} />
// AFTER:
<X className="h-4 w-4 text-white/40" />
```

### 4. `web/src/components/feedback/ReleaseNotes.tsx`

**Line 72** — Version label color:
```tsx
// BEFORE:
<span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
// AFTER:
<span className="text-sm font-semibold text-white/90">
```

**Line 90** — Divider border color:
```tsx
// BEFORE:
<div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--glass-border)' }}>
// AFTER:
<div className="border-t border-white/[0.06] px-4 pb-4 pt-3">
```

### 5. `web/src/components/feedback/Toast.tsx`

**Line 93** — Toast background:
```tsx
// BEFORE:
style={{ background: 'var(--surface-2)' }}
// AFTER: Add `bg-white/[0.03]` to the className and remove the style attribute.
```

### 6. `web/src/components/layout/Layout.tsx`

**Line 298** — Root container background/color:
```tsx
// BEFORE:
<div className="flex h-dvh" style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}>
// AFTER: `var(--bg)` is the page background — use `bg-[var(--bg)]` as a Tailwind arbitrary value
//   or replace with the actual dark background class. Since --bg is theme-dynamic, use:
<div className="flex h-dvh bg-[var(--bg)] text-white/90">
// NOTE: If var(--bg) is always the same dark color, use `bg-gray-950` or similar.
//   If it changes per theme, keep as arbitrary value `bg-[var(--bg)]`.
```

**Line 339** — Sidebar border and background:
```tsx
// BEFORE:
style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)' }}
// AFTER: Add to className: `border-white/[0.06] bg-white/[0.04]`
```

**Line 354** — Search section border:
```tsx
// BEFORE:
<div className="px-4 py-3 border-b shrink-0" style={{ borderColor: 'var(--glass-border)' }}>
// AFTER:
<div className="px-4 py-3 border-b border-white/[0.06] shrink-0">
```

**Line 427** — Bottom status border:
```tsx
// BEFORE:
<div className="border-t px-4 py-3 space-y-2 shrink-0 safe-bottom" style={{ borderColor: 'var(--glass-border)' }}>
// AFTER:
<div className="border-t border-white/[0.06] px-4 py-3 space-y-2 shrink-0 safe-bottom">
```

**NOTE:** Line 342 also has `style={{ borderColor: 'var(--glass-border)' }}` on the NavLink — fix that too if present. Read the full area around lines 340-355.

### 7. `web/src/components/layout/PageHeader.tsx`

**Line 14** — Subtitle color:
```tsx
// BEFORE:
{subtitle && <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm" style={{ color: 'var(--text-secondary)' }}>{subtitle}</p>}
// AFTER:
{subtitle && <p className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-white/60">{subtitle}</p>}
```

### 8. `web/src/components/ui/CommandPalette.tsx`

**Line 110** — Outer container border/background/shadow:
```tsx
// BEFORE:
style={{ border: '1px solid var(--glass-border)', background: 'var(--surface-1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)' }}
// AFTER: Move border and background to className, keep boxShadow in style
// className="overflow-hidden rounded-2xl shadow-2xl border border-white/[0.06] bg-white/[0.04]"
// style={{ boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)' }}
```

**Line 112** — Search input area border:
```tsx
// BEFORE:
<div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--glass-border)' }}>
// AFTER:
<div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
```

**Line 122** — Input text color:
```tsx
// BEFORE:
style={{ color: 'var(--text-primary)' }}
// AFTER: Add `text-white/90` to className, remove style.
// NOTE: The Input component may need className merging. Check if existing className handles it.
```

### 9. `web/src/components/ui/HelpTooltip.tsx`

**Line 8** — Help icon color:
```tsx
// BEFORE:
<HelpCircle className="h-3.5 w-3.5 cursor-help" style={{ color: 'var(--text-muted)' }}
// AFTER:
<HelpCircle className="h-3.5 w-3.5 cursor-help text-white/40"
```

**Line 12** — Tooltip popup background/color/border:
```tsx
// BEFORE:
style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}
// AFTER: Add to className: `bg-white/[0.03] text-white/90 border border-white/[0.06]`
```

### 10. `web/src/components/ui/Logo.tsx`

**Line 31** — Wordmark text color:
```tsx
// BEFORE:
<span className="font-bold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
// AFTER:
<span className="font-bold text-sm tracking-tight text-white/90">
```

### 11. `web/src/features/notifications/pages/AlertStudioPage.tsx`

**Line 536** — SSE notification text color:
```tsx
// BEFORE:
<span style={{ color: 'var(--text-primary)' }}>Browser toast notification (real-time via SSE)</span>
// AFTER:
<span className="text-white/90">Browser toast notification (real-time via SSE)</span>
```

**Line 540** — Alert history text color:
```tsx
// BEFORE:
<span style={{ color: 'var(--text-primary)' }}>Alert history (saved to database)</span>
// AFTER:
<span className="text-white/90">Alert history (saved to database)</span>
```

## Verification

After all changes, run:

```bash
cd web && npx tsc --noEmit
```

TypeScript must compile with zero errors. If any type error appears related to `style` prop removal, ensure the element's type still accepts `className`.

Then run the audit tool to confirm zero `static-inline-style` violations remain:

```bash
# Re-run the audit on each fixed file
```

## Important Notes

- Do NOT remove `style={{}}` attributes that contain dynamic values like `style={{ backgroundColor: borderColor }}` or `style={{ color: trendClr }}` — those are computed at runtime and are allowed.
- Line 26 of ChartTooltip (`style={{ backgroundColor: p.color || p.fill, boxShadow: ... }}`) is dynamic — do NOT touch it.
- Lines 386, 391, 393, 404 of InsightsEngine use dynamic `borderColor`/`backgroundColor`/`color` from variables — do NOT touch those.
- Line 85 of InstallPrompt uses `linear-gradient` — that's dynamic/complex, leave it.
- Lines 77, 97 of ReleaseNotes use dynamic `badge.text`/`badge.bg` — leave those.
- Line 323 of Layout (`style={{ top: '56px' }}`) is a computed layout value — leave it.
