---
description: "Fix AnalyticsPage — compare against original and restore missing functionality"
---

# Fix: AnalyticsPage — Comparison with Original

> **🟢 Page appears complete (96% of original)** but verify all sections are present — sections or components may have been dropped during refactoring.

## Comparison Summary

| Metric | Original (Analytics.tsx) | Refactored (AnalyticsPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 737 | 709 | 96% |
| Sections (GlassPanel/h2/h3) | 28 | 12 | -16 |
| Component instances | 344 | 186 | -158 |
| Chart references | 170 | 86 | -84 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/Analytics.tsx > /tmp/old_Analytics.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_Analytics.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/analytics/pages/AnalyticsPage.tsx` and check each original section:
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
OLD=737
NEW=$(wc -l < src/features/analytics/pages/AnalyticsPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/analytics/pages/AnalyticsPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/analytics/pages/AnalyticsPage.tsx
grep -c "from 'recharts'" src/features/analytics/pages/AnalyticsPage.tsx
grep -c "vehicleId=" src/features/analytics/pages/AnalyticsPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (516+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
