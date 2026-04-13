---
description: "Fix TrueCostPage — compare against original and restore missing functionality"
---

# Fix: TrueCostPage — Comparison with Original

> **⛔ MISSING PAGE** — Page does not exist yet. Create it from scratch following Step 1 to extract all sections from the original.

## Comparison Summary

| Metric | Original (TrueCostOwnership.tsx) | Refactored (TrueCostPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 196 | 0 | 0% |
| Sections (GlassPanel/h2/h3) | 7 | 0 | -7 |
| Component instances | 73 | 0 | -73 |
| Chart references | 36 | 0 | -36 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/TrueCostOwnership.tsx > /tmp/old_TrueCostOwnership.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_TrueCostOwnership.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/charging/pages/TrueCostPage.tsx` and check each original section:
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
OLD=196
NEW=$(wc -l < src/features/charging/pages/TrueCostPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/charging/pages/TrueCostPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/charging/pages/TrueCostPage.tsx
grep -c "from 'recharts'" src/features/charging/pages/TrueCostPage.tsx
grep -c "vehicleId=" src/features/charging/pages/TrueCostPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (138+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
