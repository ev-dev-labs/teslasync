---
description: "Fix SignalGapDetectorPage — compare against original and restore missing functionality"
---

# Fix: SignalGapDetectorPage — Comparison with Original

> **🟢 Page appears complete (114% of original)** but verify all sections are present — sections or components may have been dropped during refactoring.

## Comparison Summary

| Metric | Original (SignalGapDetector.tsx) | Refactored (SignalGapDetectorPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 204 | 233 | 114% |
| Sections (GlassPanel/h2/h3) | 2 | 2 | 0 |
| Component instances | 40 | 37 | -3 |
| Chart references | 1 | 1 | 0 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/SignalGapDetector.tsx > /tmp/old_SignalGapDetector.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_SignalGapDetector.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/telemetry/pages/SignalGapDetectorPage.tsx` and check each original section:
- Is it present? → Mark ✅
- Is it missing? → Mark ❌ and note what's gone
- Is it reduced? → Mark ⚠️ and note what's simplified

## Step 3: Fix missing/reduced sections

For each ❌ or ⚠️ section, restore it using the NEW architecture:
- Import from `@/components/{category}/` barrels (not raw HTML or direct library imports)
- Use TanStack Query hooks from `@/api/hooks/` (not fetch/useEffect)
- Use `useTranslation()` for all strings
- Always show sections with EmptyState when data is null (never hide)
- Use Tailwind CSS (no inline `style={{}}` with static `var(--*)`)
- Use `cn()` for conditional classes

## Step 4: Verify hook URLs

For every API hook used in this page, confirm the URL matches a route in `internal/api/router.go`.
The `request()` client auto-adds `/api/v1` — hooks must NOT include this prefix.
Query params must use snake_case: `vehicle_id`, not `vehicleId`.

## Step 5: Verify

```bash
cd web
npx tsc --noEmit

# Line count
OLD=204
NEW=$(wc -l < src/features/telemetry/pages/SignalGapDetectorPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/telemetry/pages/SignalGapDetectorPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/telemetry/pages/SignalGapDetectorPage.tsx
grep -c "from 'recharts'" src/features/telemetry/pages/SignalGapDetectorPage.tsx
grep -c "vehicleId=" src/features/telemetry/pages/SignalGapDetectorPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (143+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
