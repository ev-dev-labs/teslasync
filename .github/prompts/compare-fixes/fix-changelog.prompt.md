---
description: "Fix ChangelogPage — compare against original and restore missing functionality"
---

# Fix: ChangelogPage — Comparison with Original

> **🟡 REDUCED (66% of original)** — Several sections are likely missing. Carefully compare and restore dropped content.

## Comparison Summary

| Metric | Original (Changelog.tsx) | Refactored (ChangelogPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 130 | 86 | 66% |
| Sections (GlassPanel/h2/h3) | 1 | 0 | -1 |
| Component instances | 16 | 11 | -5 |
| Chart references | 3 | 2 | -1 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/Changelog.tsx > /tmp/old_Changelog.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_Changelog.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/system/pages/ChangelogPage.tsx` and check each original section:
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
OLD=130
NEW=$(wc -l < src/features/system/pages/ChangelogPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/system/pages/ChangelogPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/system/pages/ChangelogPage.tsx
grep -c "from 'recharts'" src/features/system/pages/ChangelogPage.tsx
grep -c "vehicleId=" src/features/system/pages/ChangelogPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (91+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
