---
name: restore-page
description: >
  Restore a gutted or skeleton page to match the original production version.
  Use this skill when a page was broken during refactoring and needs to be rebuilt
  with all original sections, charts, and functionality intact.
allowed-tools: shell
---

# Restore Gutted Page Skill

Systematic process for restoring a page that was gutted during refactoring.

## Step-by-Step Process

### Step 1: Retrieve the Original

```bash
# Find the original page in git history
git log --all --oneline -- "web/src/pages/OriginalName.tsx"

# Extract the original from the last good commit
git show COMMIT_SHA:web/src/pages/OriginalName.tsx > /tmp/old_page.tsx

# Count lines
wc -l /tmp/old_page.tsx
```

### Step 2: Catalog the Original

Analyze the old page and document EVERY section:

```bash
# Find section comments
grep -n "Section\|section\|=====" /tmp/old_page.tsx

# Find all components used
grep -oP '<[A-Z][A-Za-z]+' /tmp/old_page.tsx | sort | uniq -c | sort -rn

# Find data hooks/sources
grep -n "useQuery\|useMemo\|useState\|use[A-Z]" /tmp/old_page.tsx

# Find API calls
grep -n "fetch\|request\|get[A-Z]\|post[A-Z]" /tmp/old_page.tsx
```

Create a checklist of every section, chart, interaction, and data source.

### Step 3: Verify Backend Endpoints

For each API call the original page made:

```bash
# Check if endpoint exists in current backend
grep -n "route_pattern" internal/api/router.go
```

Map old API calls to current endpoints. If an endpoint moved, find the new path.
If an endpoint is missing, report it — do not invent fake endpoints.

### Step 4: Verify Hooks

```bash
# Check existing hooks
grep -rn "keyword" web/src/api/hooks/
```

Create any missing hooks before building the page.

### Step 5: Check Shared Components

```bash
# List available shared components
find web/src/components/ -name "index.ts" -exec grep "export" {} \;
```

For each component the original used, find the shared equivalent:
- Old `<GlassPanel>` → new `<GlassPanel>` from `@/components/ui`
- Old `<CircularGauge>` → new `<RadialGauge>` from `@/components/charts`
- Old `<MetricCard>` → new `<MetricCard>` from `@/components/data-display`
- Old inline recharts → import from `@/components/charts` barrel
- Old `clsx()` → new `cn()` from `@/lib/cn`

Create missing shared components BEFORE rebuilding the page.

### Step 6: Rebuild

Rewrite the page following ALL architecture rules:
- PageContainer wrapper
- TanStack Query hooks for all data
- useTranslation() for all strings
- Shared components only (no raw HTML, no direct library imports)
- Every section always renders (EmptyState for missing data)
- Tailwind only (no static inline styles)
- Null safety on all optional fields

### Step 7: Verify

```bash
cd web

# TypeScript
npx tsc --noEmit

# Line count comparison
echo "Old: $(wc -l < /tmp/old_page.tsx) lines"
echo "New: $(wc -l < src/features/*/pages/NewPage.tsx) lines"
# New should be ≥ 70% of old

# Section count
echo "Old sections: $(grep -c 'Section\|=====' /tmp/old_page.tsx)"
echo "New sections: $(grep -c 'GlassPanel\|ChartContainer' src/features/*/pages/NewPage.tsx)"

# Violations check
bash ../.github/skills/audit-violations/audit.sh src/features/*/pages/NewPage.tsx
```

## Common Issues

- **Page shows empty**: Usually means hooks call non-existent endpoints + `empty={!data}` gate
- **400 Bad Request**: Usually wrong URL structure or missing query params
- **404 Not Found**: Usually double `/api/v1/` prefix or endpoint doesn't exist
- **Missing sections**: Agent skipped them — compare against Step 2 checklist
- **Charts broken**: Usually direct recharts import instead of barrel, or missing data transform
