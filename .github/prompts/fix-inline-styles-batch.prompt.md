---
description: "Fix inline styles in 7 pages — replace static CSS vars with Tailwind classes"
---

# Fix Inline Styles — 7 Pages Over the ≤2 Limit

## ⛔ Rules
- **DO NOT** remove dynamic styles (value from a variable/function). Those are OK.
- **DO** replace static `style={{ color: 'var(--text-primary)' }}` with `className="text-[var(--text-primary)]"`.
- **DO** replace static `style={{ backgroundColor: '...' }}` with `className="bg-[...]"`.
- Each file must end with **≤2 inline styles** (only truly dynamic ones remain).
- **DO NOT** change any logic, hooks, or component structure.
- **DO NOT** use `git mv`.

**Branch:** `refactor/full-rewrite`

---

## Understanding: Static vs Dynamic

**STATIC (must convert to Tailwind):**
```tsx
style={{ color: 'var(--text-primary)' }}      →  className="text-[var(--text-primary)]"
style={{ color: 'var(--text-muted)' }}         →  className="text-[var(--text-muted)]"
style={{ color: 'var(--text-secondary)' }}     →  className="text-[var(--text-secondary)]"
style={{ color: 'var(--theme-primary)' }}      →  className="text-[var(--theme-primary)]"
style={{ backgroundColor: 'var(--glass-border)' }} → className="bg-[var(--glass-border)]"
style={{ fontSize: 10 }}                       →  className="text-[10px]"
```

**DYNAMIC (keep as-is, counts toward ≤2 budget):**
```tsx
style={{ color }}                    // prop/variable — KEEP
style={{ color: phase.color }}       // runtime value — KEEP
style={{ color: getStatusColor(x) }} // function call — KEEP
style={{ backgroundColor: `${x}15` }} // template literal — KEEP
style={{ borderColor: someVar ? a : b }} // ternary with var — KEEP
style={mapStyle}                     // object prop — KEEP
```

**Recharts `wrapperStyle` / `contentStyle` — these are library API, NOT inline CSS. KEEP them.**

---

## File 1: SettingsPage.tsx (31 → ≤2)

**Path:** `web/src/features/settings/pages/SettingsPage.tsx`

This is the worst offender. Almost all 31 are `color: 'var(--text-*)'`.

### Conversion table for this file:
| Pattern | Tailwind class |
|---------|---------------|
| `style={{ color: 'var(--text-primary)' }}` | `className="text-[var(--text-primary)]"` |
| `style={{ color: 'var(--text-muted)' }}` | `className="text-[var(--text-muted)]"` |
| `style={{ color: 'var(--text-secondary)' }}` | `className="text-[var(--text-secondary)]"` |
| `style={{ color: 'var(--theme-primary)' }}` | `className="text-[var(--theme-primary)]"` |

**When element already has className**, merge:
```tsx
// BEFORE:
<p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>

// AFTER:
<p className="text-sm font-medium text-[var(--text-primary)]">
```

**Theme selector styles — these have dynamic values, KEEP:**
- `style={{ boxShadow: 'inset 0 0 12px ...' }}` with ternary → KEEP
- `style={{ borderColor: themeId === ... }}` with ternary → KEEP  
- `style={{ backgroundColor: thm.primary }}` → KEEP (runtime value)
- `style={{ color: thm.primary }}` → KEEP (runtime value)
- `style={{ color: m.textPrimary }}` → KEEP (runtime value)
- `style={{ color: customPrimary }}` → KEEP (runtime value)
- Color swatch `style={{ backgroundColor: c }}` → KEEP (runtime value)

### Verify:
```bash
COUNT=$(grep -c "style={" web/src/features/settings/pages/SettingsPage.tsx)
echo "SettingsPage: $COUNT inline styles (must be ≤2, remaining should all be dynamic)"
```

---

## File 2: EnergyPage.tsx (6 → ≤2)

**Path:** `web/src/features/battery/pages/EnergyPage.tsx`

Lines 43, 47, 52, 54, 57 are static `var(--text-*)`. Line 519 is dynamic (`b.fill`).

**Fix lines 43, 47, 52, 54, 57:**
```tsx
// Each one: remove style={{ color: 'var(--text-*)' }} and add to className
style={{ color: 'var(--text-secondary)' }}  →  className includes "text-[var(--text-secondary)]"
style={{ color: 'var(--text-muted)' }}      →  className includes "text-[var(--text-muted)]"
```

**KEEP line 519:** `style={{ backgroundColor: b.fill }}` — dynamic.

### Verify:
```bash
COUNT=$(grep -c "style={" web/src/features/battery/pages/EnergyPage.tsx)
echo "EnergyPage: $COUNT (must be ≤2)"
```

---

## File 3: ApiLogsPage.tsx (4 → ≤2)

**Path:** `web/src/features/admin/pages/ApiLogsPage.tsx`

Find all 4 `style={` occurrences. Convert static var-based ones to Tailwind.

### Verify:
```bash
COUNT=$(grep -c "style={" web/src/features/admin/pages/ApiLogsPage.tsx)
echo "ApiLogsPage: $COUNT (must be ≤2)"
```

---

## File 4: DriveScorePage.tsx (5 → ≤2)

**Path:** `web/src/features/driving/pages/DriveScorePage.tsx`

Lines 1332, 1423, 1443, 1462, 1472 — all use dynamic `gradeColor()` or computed values.

**Check each one:**
- `style={{ color: gradeColor(ds.grade) }}` → DYNAMIC (function call) → KEEP
- `style={{ color: periodStats.thisWeekAvg... }}` → DYNAMIC → KEEP

If ALL 5 are truly dynamic (function calls or variables), they're acceptable.
But if any use a static color string, convert it.

**If >2 are dynamic and must stay:** Create CSS utility classes or use `cn()` with a color map:
```tsx
// Option: use a lookup + cn()
const gradeTextClass: Record<string, string> = {
  'A+': 'text-[#39ff14]', A: 'text-green-400', B: 'text-cyan-400',
  C: 'text-amber-400', D: 'text-orange-400', F: 'text-red-400',
};
// Then: className={gradeTextClass[grade] ?? 'text-gray-400'}
```

Only do this if the count is >2 after removing statics.

### Verify:
```bash
COUNT=$(grep -c "style={" web/src/features/driving/pages/DriveScorePage.tsx)
echo "DriveScorePage: $COUNT (must be ≤2)"
```

---

## File 5: DriveDetailPage.tsx (8 → ≤2)

**Path:** `web/src/features/driving/pages/DriveDetailPage.tsx`

**Dynamic (KEEP):**
- L46: `style={{ color }}` — prop variable
- L545: `style={mapStyle}` — MapTileLayer prop
- L664: `style={{ borderColor: item.color, borderStyle: 'solid' }}` — runtime
- L665: `style={{ color: item.color }}` — runtime
- L851: `style={{ color: tp.color }}` — runtime

**Recharts API (KEEP as library requirement):**
- L708: `wrapperStyle={{ fontSize: 10 }}`
- L770: `wrapperStyle={{ fontSize: 10, color: '#9ca3af' }}`
- L864: `wrapperStyle={{ fontSize: 10, color: '#9ca3af' }}`

Since 5 are dynamic and 3 are Recharts API — convert the Recharts `wrapperStyle` to use
a shared constant to reduce repetition, but these are NOT inline CSS violations
(they're component props). Grep counts them as `style={` though.

**Solution:** Extract a constant:
```tsx
const LEGEND_STYLE = { fontSize: 10, color: '#9ca3af' } as const;
// Then use: <Legend wrapperStyle={LEGEND_STYLE} />
```

This doesn't reduce the grep count, but it's the correct pattern. If ALL 8 are
dynamic/library, this file is actually compliant. Document in commit that remaining
`style={` are all dynamic props or Recharts API.

### Verify:
```bash
# Count only TRUE inline CSS (not wrapperStyle/contentStyle/component props)
grep -n "style={{" web/src/features/driving/pages/DriveDetailPage.tsx | grep -v "wrapperStyle\|contentStyle"
echo "DriveDetailPage: only dynamic styles should remain"
```

---

## File 6: SystemStatusPage.tsx (11 → ≤2)

**Path:** `web/src/features/system/pages/SystemStatusPage.tsx`

**Dynamic (KEEP):**
- L131, 137, 143, 145: `style={{ color }}` — variable prop
- L452, 936, 1147: `style={{ color: getStatusColor(row.status) }}` — function call
- L1607, 1611, 1623: `style={{ color: getStatusColor(overallStatus) }}` — function call

**Recharts API (KEEP):**
- L1449: `contentStyle={{ ... }}`

All 11 are dynamic or Recharts API. Convert the repeated `getStatusColor()` inline styles to a
helper that returns a Tailwind class:
```tsx
function statusTextClass(status: string): string {
  switch (status) {
    case 'healthy': return 'text-green-400';
    case 'degraded': return 'text-amber-400';
    case 'down': return 'text-red-400';
    default: return 'text-gray-400';
  }
}
// Then: className={statusTextClass(row.status)} instead of style={{ color: getStatusColor(...) }}
```

### Verify:
```bash
COUNT=$(grep -c "style={{" web/src/features/system/pages/SystemStatusPage.tsx | grep -v "wrapperStyle\|contentStyle")
echo "SystemStatusPage: check remaining"
```

---

## File 7: RoadmapPage.tsx (7 → ≤2)

**Path:** `web/src/features/system/pages/RoadmapPage.tsx`

**Dynamic (KEEP — all use `phase.color` or `config.color`):**
- L321, 326, 327, 381, 382, 406: all use runtime variables

**Static:**
- L388: `style={{ backgroundColor: 'var(--glass-border)' }}` → `className="bg-[var(--glass-border)]"`

Convert the one static. If remaining dynamic count is >2, create a helper or use cn():
```tsx
// For phase colors that come from data, style={{ }} is acceptable
// But try to minimize — use cn() where the color set is known
```

### Verify:
```bash
COUNT=$(grep -c "style={" web/src/features/system/pages/RoadmapPage.tsx)
echo "RoadmapPage: $COUNT (must be ≤2, rest must be dynamic)"
```

---

## FINAL VERIFICATION

```bash
echo "=== Inline Style Counts (each ≤2 static, dynamic OK) ==="
for f in \
  web/src/features/settings/pages/SettingsPage.tsx \
  web/src/features/battery/pages/EnergyPage.tsx \
  web/src/features/admin/pages/ApiLogsPage.tsx \
  web/src/features/driving/pages/DriveScorePage.tsx \
  web/src/features/driving/pages/DriveDetailPage.tsx \
  web/src/features/system/pages/SystemStatusPage.tsx \
  web/src/features/system/pages/RoadmapPage.tsx; do
  TOTAL=$(grep -c "style={" "$f" 2>/dev/null)
  # Count static var-based styles (the real violations)
  STATIC=$(grep "style={{" "$f" | grep -c "'var(--")
  NAME=$(basename "$f")
  echo "$NAME: total=$TOTAL, static_var=$STATIC (static must be 0)"
done

echo ""
echo "=== TypeScript ==="
cd web && npx tsc --noEmit 2>&1 | tail -5
cd ..

echo ""
echo "=== No raw HTML ==="
grep -rn "<button \|<input \|<table \|<select " web/src/features/ --include="*.tsx" | head -5
echo "(must be empty)"
```

**Zero static `var(--*)` inline styles. TypeScript passes. No raw HTML.**

---

## COMMIT MESSAGE

```
fix: replace static inline styles with Tailwind classes across 7 pages

- SettingsPage: 31→dynamic-only (var(--text-*) → text-[var(--text-*)])
- EnergyPage: 6→1 (static var colors → Tailwind)
- ApiLogsPage: 4→0
- DriveScorePage: grade colors → className lookup map
- SystemStatusPage: status colors → className helper
- RoadmapPage: 1 static var → Tailwind
- DriveDetailPage: extract shared LEGEND_STYLE constant

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
