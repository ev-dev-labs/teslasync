# Fix Remaining Static Inline Styles — Batch 3

> **Context**: 16 static `var(--*)` inline styles remain across 8 files.
> 8 are dynamic/conditional (acceptable). 8 are static and must be converted.

---

## File 1: BatteryDegradationPage.tsx — 4 static

**File**: `web/src/features/battery/pages/BatteryDegradationPage.tsx`

All 4 are `style={{ color: 'var(--text-muted)' }}` → convert to class:

| Line | Before | After |
|------|--------|-------|
| 289 | `<div className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>` | `<div className="mt-4 text-xs text-[var(--text-muted)]">` |
| 400 | `<div className="space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>` | `<div className="space-y-1 text-xs text-[var(--text-muted)]">` |
| 422 | `<div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>` | `<div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">` |
| 438 | `<div className="space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>` | `<div className="space-y-1 text-xs text-[var(--text-muted)]">` |

## File 2: ChatbotPage.tsx — 1 static

**File**: `web/src/features/system/pages/ChatbotPage.tsx`

| Line | Before | After |
|------|--------|-------|
| 269 | `<div className="p-4 border-t" style={{ borderColor: 'var(--glass-border)' }}>` | `<div className="p-4 border-t border-[var(--glass-border)]">` |

## Files to SKIP — all dynamic/conditional (no changes needed)

- **DataExportPage.tsx** (3): conditional `var(--neon-${et.color})` — dynamic ✅
- **SettingsPage.tsx** (3): conditional boxShadow/borderColor with ternary — dynamic ✅
- **NotificationsPage.tsx** (2): conditional `ct.color` vs `var(--text-secondary)` — dynamic ✅
- **SignalLogViewerPage.tsx** (1): conditional `CHART_COLORS[idx]` vs `var(--text-muted)` — dynamic ✅
- **WeeklyDigestPage.tsx** (1): `wrapperStyle` — Recharts Legend API — library ✅
- **SecurityAccessPage.tsx** (1): `wrapperStyle` — Recharts Legend API — library ✅

---

## Verification

```powershell
# Static var(--) inline styles count
$pages = Get-ChildItem -Recurse web\src\features\*\pages\*.tsx
Select-String -Path $pages -Pattern "style=\{.*var\(--" | Measure-Object
# Target: 11 (down from 16 — the 5 removed + 11 dynamic/library remaining)

# TypeScript
cd web; npx tsc --noEmit
```

## Do NOT:
- Touch the dynamic/conditional styles listed as SKIP above
- Touch Recharts `wrapperStyle` — that's library API
- Remove any sections or functionality
