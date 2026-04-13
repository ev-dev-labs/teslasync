---
description: "Fix VehicleDetailPage — compare against original and restore missing functionality"
---

# Fix: VehicleDetailPage — Comparison with Original

> **🟢 Page appears complete (95% of original)** but verify all sections are present — sections or components may have been dropped during refactoring.

## Comparison Summary

| Metric | Original (VehicleDetail.tsx) | Refactored (VehicleDetailPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 1054 | 998 | 95% |
| Sections (GlassPanel/h2/h3) | 35 | 21 | -14 |
| Component instances | 329 | 236 | -93 |
| Chart references | 49 | 41 | -8 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/VehicleDetail.tsx > /tmp/old_VehicleDetail.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_VehicleDetail.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/vehicles/pages/VehicleDetailPage.tsx` and check each original section:
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
OLD=1054
NEW=$(wc -l < src/features/vehicles/pages/VehicleDetailPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/vehicles/pages/VehicleDetailPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/vehicles/pages/VehicleDetailPage.tsx
grep -c "from 'recharts'" src/features/vehicles/pages/VehicleDetailPage.tsx
grep -c "vehicleId=" src/features/vehicles/pages/VehicleDetailPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (738+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
