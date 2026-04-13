---
description: "Fix MediaPlayerPage — compare against original and restore missing functionality"
---

# Fix: MediaPlayerPage — Comparison with Original

> **🟢 Page appears complete (106% of original)** but verify all sections are present — sections or components may have been dropped during refactoring.

## Comparison Summary

| Metric | Original (MediaPlayer.tsx) | Refactored (MediaPlayerPage.tsx) | Delta |
|--------|-------------------------|-------------------------------|-------|
| Lines | 500 | 529 | 106% |
| Sections (GlassPanel/h2/h3) | 18 | 9 | -9 |
| Component instances | 155 | 93 | -62 |
| Chart references | 26 | 29 | +3 |

## Step 1: Extract original sections

```bash
git show c62e622:web/src/pages/MediaPlayer.tsx > /tmp/old_MediaPlayer.tsx
grep -n "Section\|=====\|<GlassPanel\|<h[23]" /tmp/old_MediaPlayer.tsx
```

Read the original and list EVERY section, chart, interaction, and data source it had.

## Step 2: Compare with refactored version

Read `web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx` and check each original section:
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
OLD=500
NEW=$(wc -l < src/features/vehicle-systems/pages/MediaPlayerPage.tsx)
echo "Old: $OLD → New: $NEW $(( NEW * 100 / OLD ))%"

# Violations
grep -c "style={{" src/features/vehicle-systems/pages/MediaPlayerPage.tsx
grep -cP '<button\b|<input\b|<textarea\b|<select\b|<table\b' src/features/vehicle-systems/pages/MediaPlayerPage.tsx
grep -c "from 'recharts'" src/features/vehicle-systems/pages/MediaPlayerPage.tsx
grep -c "vehicleId=" src/features/vehicle-systems/pages/MediaPlayerPage.tsx
```

**COMPLETION DEFINITION:**
- [ ] Every section from the original page is present (or has explicit EmptyState)
- [ ] Line count ≥ 70% of original (350+ lines)
- [ ] All hook URLs match backend routes
- [ ] Zero static inline styles, zero raw HTML, zero direct library imports
- [ ] TypeScript compiles clean
- [ ] DO NOT revert to old code patterns — fix using new architecture only
