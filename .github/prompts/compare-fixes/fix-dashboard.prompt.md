---
description: "Fix DashboardPage — compare against original and restore missing functionality"
---

# Fix: DashboardPage — Comparison with Original

> **🔴 GUTTED (34% of original)** — Most sections are missing. This page needs a full rebuild using the new architecture.

## Comparison Summary

| Metric | Original (Dashboard.tsx) | Refactored (DashboardPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 1018 | 351 | 34% |
| Sections (GlassPanel/h2/h3) | 35 | 5 | -30 |
| Component instances | 285 | 59 | -226 |
| Chart references | 47 | 9 | -38 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/Dashboard.tsx > /tmp/old_Dashboard.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_Dashboard.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/dashboard/pages/DashboardPage.tsx` and check each original section:
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
OLD=1018
NEW=$(wc -l < src/features/dashboard/pages/DashboardPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/dashboard/pages/DashboardPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/dashboard/pages/DashboardPage.tsx
grep -c "from 'recharts'" src/features/dashboard/pages/DashboardPage.tsx
grep -c "vehicleId=" src/features/dashboard/pages/DashboardPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (713+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
