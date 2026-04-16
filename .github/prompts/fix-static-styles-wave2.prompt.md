# Fix Static Inline Styles — Wave 2 (28 violations, 13 files)

> **Context**: The audit found 28 `[static-inline-style]` violations — elements using
> `style={{ color: 'var(--*)' }}` or similar static CSS custom properties in inline styles
> instead of Tailwind classes.

---

## ⛔ Rules

- **DO NOT** change any component logic, hooks, or structure.
- **DO NOT** remove dynamic styles (value from a variable, ternary, function call, array index). Those are allowed.
- **DO** replace static `style={{ prop: 'var(--*)' }}` with Tailwind arbitrary value classes.
- When a `style={{}}` has a mix of static and dynamic properties, extract only the static ones to classes and keep the dynamic ones in `style`.
- After all changes, run `npx tsc --noEmit` and `audit_code` on each file.

## Conversion Reference

```tsx
// color
style={{ color: 'var(--text-primary)' }}      → className="... text-[var(--text-primary)]"
style={{ color: 'var(--text-secondary)' }}     → className="... text-[var(--text-secondary)]"
style={{ color: 'var(--text-muted)' }}         → className="... text-[var(--text-muted)]"

// background
style={{ background: 'var(--surface-1)' }}     → className="... bg-[var(--surface-1)]"
style={{ background: 'var(--surface-2)' }}     → className="... bg-[var(--surface-2)]"
style={{ background: 'var(--bg)' }}            → className="... bg-[var(--bg)]"
style={{ background: 'var(--bg, #0a0e1a)' }}   → className="... bg-[var(--bg,#0a0e1a)]"

// border
style={{ borderColor: 'var(--glass-border)' }} → className="... border-[var(--glass-border)]"

// compound style objects: extract static, keep dynamic
style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}
→ className="... bg-[var(--surface-2)] border-[var(--glass-border)] shadow-[0_8px_32px_rgba(0,0,0,0.3)]"

// If only static props remain → remove style={{}} entirely
// If a mix remains → keep style={{}} with only the dynamic props
```

---

## File 1: `web/src/components/charts/ChartTooltip.tsx` — 3 violations

This is a **chart tooltip** component. The outer `<div>` already has `style={{}}` with a mix of static values and a literal boxShadow. All 3 can be converted.

| Line | Element | Before | After (add to className, remove from style) |
|------|---------|--------|------|
| 15–19 | Outer `<div>` | `style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}` | `className="... bg-[var(--surface-2)] border-[var(--glass-border)] shadow-[0_8px_32px_rgba(0,0,0,0.3)]"` — remove the entire `style` prop |
| 21 | `<p>` label | `style={{ color: 'var(--text-secondary)' }}` | `className="mb-1.5 font-medium text-[var(--text-secondary)]"` — remove `style` |
| 28 | `<span>` name | `style={{ color: 'var(--text-secondary)' }}` | `className="text-[var(--text-secondary)]"` — remove `style` |
| 29 | `<span>` value | `style={{ color: 'var(--text-primary)' }}` | `className="font-mono font-semibold text-[var(--text-primary)]"` — remove `style` |

**Note**: Line 26 has `style={{ backgroundColor: p.color || p.fill, boxShadow: ... }}` — this is **dynamic** (uses variables `p.color`, `p.fill`). **Leave it as-is.**

---

## File 2: `web/src/components/data-display/InsightsEngine.tsx` — 3 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 366 | `<h3>` | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |
| 400 | `<span>` title | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |
| 408 | `<p>` description | `style={{ color: 'var(--text-secondary)' }}` | Add `text-[var(--text-secondary)]` to className, remove `style` |

**Note**: Lines 386 (`borderLeftColor: borderColor`), 391 (`backgroundColor: ${borderColor}15`), 393 (`color: borderColor`), 404 (`color: trendClr`) are all **dynamic**. Leave them.

---

## File 3: `web/src/components/feedback/InstallPrompt.tsx` — 3 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 75 | `<p>` title | `style={{ color: 'var(--text-primary, #fff)' }}` | Add `text-[var(--text-primary,#fff)]` to className, remove `style` |
| 78 | `<p>` subtitle | `style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }}` | Add `text-[var(--text-muted,rgba(255,255,255,0.5))]` to className, remove `style` |
| 94 | `<X>` icon | `style={{ color: 'var(--text-muted, rgba(255,255,255,0.5))' }}` | Add `text-[var(--text-muted,rgba(255,255,255,0.5))]` to className, remove `style` |

**Note**: Line 85 (`style={{ background: 'linear-gradient(135deg, #00f0ff, #10b981)' }}`) is a complex gradient — this is a static literal, not a var(--*), so it's **not flagged** by the auditor. Leave it, or optionally convert to `bg-gradient-to-br from-[#00f0ff] to-[#10b981]` for consistency (not required).

---

## File 4: `web/src/components/feedback/ReleaseNotes.tsx` — 2 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 72 | `<span>` version | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |
| 90 | `<div>` expanded section | `style={{ borderColor: 'var(--glass-border)' }}` | Add `border-[var(--glass-border)]` to className, remove `style` |

**Note**: Line 71 `style={{ color: badge.text }}` and line 77 `style={{ background: badge.bg, color: badge.text, border: ... }}` are **dynamic**. Leave them.

---

## File 5: `web/src/components/feedback/Toast.tsx` — 1 violation

| Line | Element | Before | After |
|------|---------|--------|-------|
| 93 | `<motion.div>` toast container | `style={{ background: 'var(--surface-2)' }}` | Add `bg-[var(--surface-2)]` to the `clsx(...)` className, remove `style` |

---

## File 6: `web/src/components/forms/RuleBuilder.tsx` — 3 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 139 | `<div>` dropdown | `style={{ background: 'var(--bg, #0a0e1a)' }}` | Add `bg-[var(--bg,#0a0e1a)]` to className, remove `style` |
| 140 | `<div>` sticky search | `style={{ background: 'var(--bg, #0a0e1a)' }}` | Add `bg-[var(--bg,#0a0e1a)]` to className, remove `style` |
| 153 | `<div>` category header | `style={{ background: 'var(--surface-2, #111827)' }}` | Add `bg-[var(--surface-2,#111827)]` to className, remove `style` |

---

## File 7: `web/src/components/layout/Layout.tsx` — 4 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 298 | Root `<div>` | `style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}` | Add `bg-[var(--bg)] text-[var(--text-primary)]` to className, remove `style` |
| 339 | `<aside>` sidebar | `style={{ borderColor: 'var(--glass-border)', background: 'var(--surface-1)' }}` | Add `border-[var(--glass-border)] bg-[var(--surface-1)]` to className, remove `style` |
| 354 | `<div>` search trigger | `style={{ borderColor: 'var(--glass-border)' }}` | Add `border-[var(--glass-border)]` to className, remove `style` |
| 427 | `<div>` bottom status | `style={{ borderColor: 'var(--glass-border)' }}` | Add `border-[var(--glass-border)]` to className, remove `style` |

**Note**: Line 342 also has `style={{ borderColor: 'var(--glass-border)' }}` on the NavLink — this is the same pattern, fix it too if present. Line 323 (`style={{ top: '56px' }}`) is a **literal pixel value**, not a var(--*) — it's not flagged. Leave it.

---

## File 8: `web/src/components/layout/PageHeader.tsx` — 1 violation

| Line | Element | Before | After |
|------|---------|--------|-------|
| 14 | `<p>` subtitle | `style={{ color: 'var(--text-secondary)' }}` | Add `text-[var(--text-secondary)]` to className, remove `style` |

---

## File 9: `web/src/components/ui/CommandPalette.tsx` — 3 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 110 | `<div>` main container | `style={{ border: '1px solid var(--glass-border)', background: 'var(--surface-1)', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)' }}` | Add `border border-[var(--glass-border)] bg-[var(--surface-1)] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.4)]` to className, remove `style`. Note: the existing className already has `shadow-2xl` — replace that with the specific shadow, or just use the arbitrary value. |
| 112 | `<div>` search row | `style={{ borderBottom: '1px solid var(--glass-border)' }}` | Add `border-b border-b-[var(--glass-border)]` to className, remove `style` |
| 122 | `<Input>` | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |

---

## File 10: `web/src/components/ui/HelpTooltip.tsx` — 2 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 8 | `<HelpCircle>` | `style={{ color: 'var(--text-muted)' }}` | Add `text-[var(--text-muted)]` to className (create one if needed: `className="h-3.5 w-3.5 cursor-help text-[var(--text-muted)]"`), remove `style` |
| 12 | `<span>` tooltip body | `style={{ background: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--glass-border)' }}` | Add `bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--glass-border)]` to className, remove `style` |

---

## File 11: `web/src/components/ui/Logo.tsx` — 1 violation

| Line | Element | Before | After |
|------|---------|--------|-------|
| 31 | `<span>` wordmark | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |

---

## File 12: `web/src/features/notifications/pages/AlertStudioPage.tsx` — 2 violations

| Line | Element | Before | After |
|------|---------|--------|-------|
| 536 | `<span>` SSE label | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |
| 540 | `<span>` DB label | `style={{ color: 'var(--text-primary)' }}` | Add `text-[var(--text-primary)]` to className, remove `style` |

---

## Verification

After all changes:

```bash
cd web
npx tsc --noEmit          # must compile cleanly
```

Then run `audit_code` on `web/src` — the `[static-inline-style]` count should drop to **0**.
