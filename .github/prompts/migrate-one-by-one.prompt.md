---
description: "Migrate pages ONE AT A TIME — verify each page meets ALL standards before moving to the next"
---

# Page-by-Page Migration — One at a Time, Fully Verified

## ⛔ ONE PAGE AT A TIME. FULLY DONE BEFORE NEXT. NO BATCHING. NO SHORTCUTS.

**Branch:** `refactor/full-rewrite`

The previous approach (batches of 10) resulted in `git mv` shortcuts. Now we do
ONE page at a time. Each page is fully rewritten, verified, and committed before
touching the next one.

**`git mv` and `cp` are BANNED. Every page is a REWRITE from scratch.**

---

## Step 1: Generate the Migration Queue

**Run this FIRST to create the queue of pages to migrate:**

```bash
# Create migration queue file
echo "# Page Migration Queue" > web/PAGE_QUEUE.md
echo "" >> web/PAGE_QUEUE.md
echo "| # | Old Page | Feature | Status | Verified |" >> web/PAGE_QUEUE.md
echo "|---|----------|---------|--------|----------|" >> web/PAGE_QUEUE.md

i=1
for f in $(find web/src/pages/ -name "*.tsx" ! -name "*.test.tsx" | sort); do
  name=$(basename "$f" .tsx)
  echo "| $i | $name | — | ⏳ QUEUED | — |" >> web/PAGE_QUEUE.md
  i=$((i+1))
done

echo "" >> web/PAGE_QUEUE.md
TOTAL=$((i-1))
echo "**Total pages to migrate: $TOTAL**" >> web/PAGE_QUEUE.md
echo "**Completed: 0 / $TOTAL (0%)**" >> web/PAGE_QUEUE.md

git add web/PAGE_QUEUE.md
git commit -m "docs: create page migration queue — $TOTAL pages"
```

---

## Step 2: Process Each Page — THE LOOP

**Pick the FIRST page with status ⏳ QUEUED from `web/PAGE_QUEUE.md` and execute ALL
sub-steps below. Do NOT skip any sub-step. Do NOT move to the next page until the
current page passes ALL verification checks.**

### For each page, execute these sub-steps in order:

#### A. ANALYZE the old page (do NOT copy it)

```bash
PAGE_NAME="[current page name, e.g., BatteryHealth]"

echo "=== Analyzing old page: $PAGE_NAME ==="

# 1. What does it render?
echo "--- Component structure ---"
grep -n "return\|<.*>" "web/src/pages/${PAGE_NAME}.tsx" | head -30

# 2. What data does it fetch?
echo "--- Data fetching ---"
grep -n "fetch\|useEffect\|useQuery\|useState\|api\." "web/src/pages/${PAGE_NAME}.tsx"

# 3. What imports does it use?
echo "--- Imports ---"
grep -n "^import" "web/src/pages/${PAGE_NAME}.tsx"

# 4. How many lines?
echo "--- Size ---"
wc -l "web/src/pages/${PAGE_NAME}.tsx"
```

**Write down: What data this page needs. What it displays. What interactions it supports.**

#### B. DETERMINE the feature category

```
Battery/Energy pages    → features/battery/
Driving/Performance     → features/driving/
Charging pages          → features/charging/
Analytics/Statistics    → features/analytics/
Location/Maps           → features/maps/
Climate/Vehicle systems → features/vehicle-systems/
Signals/Telemetry       → features/telemetry/
Admin/DevTools          → features/admin/
System/Ops              → features/system/
Notifications/Alerts    → features/notifications/
Dashboard variants      → features/dashboard/
Settings                → features/settings/
```

#### C. CREATE OR VERIFY the API hook

```bash
# Does this page need data? Check if a hook exists:
ls web/src/api/hooks/

# If the page fetches data and no hook exists for it → CREATE ONE:
# web/src/api/hooks/use{Feature}.ts
# - Query key factory
# - useQuery hook using apiClient
# - Proper TypeScript return types
```

#### D. CREATE the new page (REWRITE, not copy)

Create `web/src/features/{category}/pages/{PageName}Page.tsx`

**Mandatory checklist — the new page MUST have ALL of these:**

```
[ ] Uses PageContainer as the wrapper
    import { PageContainer } from '@/components/layout';

[ ] Uses TanStack Query hook for data (if page shows data)
    const { data, isLoading, error } = useSomeHook();

[ ] Passes loading/error/empty to PageContainer
    <PageContainer loading={isLoading} error={error} empty={!data?.length}>

[ ] Uses ONLY shared components for UI — NO raw HTML
    import { DataTable, StatCard, Button, Card } from '@/components/...';

[ ] Uses useTranslation() for ALL user-facing text
    const { t } = useTranslation('{feature}');

[ ] Has strict TypeScript types — NO any
    All props typed, all data typed, all events typed

[ ] Handles ALL states: loading, error, empty, data
    Not just the happy path

[ ] Max 200 lines — extract sub-components if larger
```

#### E. UPDATE the route in App.tsx

```tsx
// Add lazy import at top of App.tsx
const NewPageName = lazy(() => import('@/features/{category}/pages/{PageName}Page'));

// Replace old route with new one
<Route path="/old-path" element={<LazyRoute><NewPageName /></LazyRoute>} />
```

#### F. DELETE the old page

```bash
rm web/src/pages/${PAGE_NAME}.tsx
# Also delete the old test file if it exists
rm web/src/pages/${PAGE_NAME}.test.tsx 2>/dev/null
```

#### G. CREATE a smoke test for the new page

```bash
# web/src/features/{category}/pages/{PageName}Page.test.tsx
# At minimum: renders without crashing, displays expected title
```

#### H. VERIFY this single page (ALL must pass)

```bash
PAGE="[NewPageName]Page"
FEATURE_DIR="web/src/features/{category}"

echo "=== VERIFYING: $PAGE ==="

# 1. File exists
test -f "$FEATURE_DIR/pages/${PAGE}.tsx" && echo "✅ File exists" || echo "❌ FILE MISSING"

# 2. Old file deleted
test ! -f "web/src/pages/${PAGE_NAME}.tsx" && echo "✅ Old file deleted" || echo "❌ OLD FILE STILL EXISTS"

# 3. Uses PageContainer
grep -q "PageContainer" "$FEATURE_DIR/pages/${PAGE}.tsx" && echo "✅ PageContainer" || echo "❌ NO PageContainer"

# 4. Uses shared components (not raw HTML)
RAW=$(grep -c "<button \|<input \|<table \|<select " "$FEATURE_DIR/pages/${PAGE}.tsx" 2>/dev/null)
[ "$RAW" -eq 0 ] && echo "✅ No raw HTML" || echo "❌ RAW HTML FOUND ($RAW occurrences)"

# 5. Uses i18n (not hardcoded strings)
grep -q "useTranslation\|{t(" "$FEATURE_DIR/pages/${PAGE}.tsx" && echo "✅ i18n" || echo "❌ NO i18n"

# 6. No fetch/useEffect for data
FETCH=$(grep -c "fetch(\|useEffect.*=>" "$FEATURE_DIR/pages/${PAGE}.tsx" 2>/dev/null)
[ "$FETCH" -eq 0 ] && echo "✅ No old fetch pattern" || echo "❌ OLD FETCH PATTERN ($FETCH)"

# 7. No any types
ANY=$(grep -c ": any" "$FEATURE_DIR/pages/${PAGE}.tsx" 2>/dev/null)
[ "$ANY" -eq 0 ] && echo "✅ No any types" || echo "❌ HAS any TYPES ($ANY)"

# 8. Route exists in App.tsx
grep -q "$PAGE" web/src/App.tsx web/src/routes/*.tsx 2>/dev/null && echo "✅ Route wired" || echo "❌ NOT ROUTED"

# 9. Build still works
cd web && npx tsc --noEmit && echo "✅ TypeScript OK" || echo "❌ TS ERRORS"
cd ..

# 10. Test exists and passes
TEST="$FEATURE_DIR/pages/${PAGE}.test.tsx"
test -f "$TEST" && echo "✅ Test file exists" || echo "❌ NO TEST"
```

**IF ANY CHECK SHOWS ❌ → FIX IT BEFORE MOVING TO NEXT PAGE.**
**ALL 10 checks must be ✅.**

#### I. UPDATE the queue and commit

```bash
# Update PAGE_QUEUE.md — change this page from ⏳ QUEUED to ✅ DONE
# Update the completed count at the bottom

# Count progress
DONE=$(find web/src/features/ -name "*Page.tsx" | wc -l)
REMAINING=$(find web/src/pages/ -name "*.tsx" ! -name "*.test.tsx" | wc -l)
TOTAL=$((DONE + REMAINING))
echo "Progress: $DONE / $TOTAL ($((DONE * 100 / TOTAL))%)"

# Commit this single page
git add -A
git commit -m "refactor: migrate $PAGE_NAME → features/{category}/ [$DONE/$TOTAL]"
```

#### J. MOVE TO NEXT PAGE

**Go back to the top of Step 2. Pick the next ⏳ QUEUED page. Repeat.**

**Do NOT stop until PAGE_QUEUE.md has ZERO ⏳ QUEUED entries.**

---

## After ALL Pages Migrated

### Final verification

```bash
echo "=== FINAL MIGRATION STATUS ==="

echo "Old pages remaining:"
find web/src/pages/ -name "*.tsx" ! -name "*.test.tsx" | wc -l  # MUST be 0

echo "New feature pages:"
find web/src/features/ -name "*Page.tsx" | wc -l  # MUST be 71+

echo "Routes using old pages/:"
grep -rn "pages/" web/src/App.tsx web/src/routes/ 2>/dev/null | grep -v node_modules | grep -v "PAGE_QUEUE\|MIGRATION" | wc -l  # MUST be 0

echo "Build:"
cd web && npm run build && echo "✅ OK" || echo "❌ FAIL"

echo ""
echo "=== PATTERN CHECK (all must be 0) ==="
echo "fetch() in features: $(grep -rc 'fetch(' web/src/features/ --include='*.tsx' 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "raw HTML in features: $(grep -rc '<button \|<input \|<table ' web/src/features/ --include='*.tsx' 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "any types in features: $(grep -rc ': any' web/src/features/ --include='*.tsx' 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "direct recharts/leaflet: $(grep -rc "from 'recharts'\|from 'react-leaflet'" web/src/features/ --include='*.tsx' 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
```

### Then continue to Docker + 50-round testing

```
1. Docker build all 4 images
2. docker compose up — verify all healthy
3. 50 consecutive test passes (fix failures, reset counter)
4. Commit final state
```

See bottom of `migrate-all-pages.prompt.md` for Docker + testing details.

---

## Progress Display

The agent updates `web/PAGE_QUEUE.md` after each page. You can check progress anytime:

```bash
cat web/PAGE_QUEUE.md | tail -5
# Shows: Completed: 34 / 71 (48%)

git log --oneline -5
# Shows: refactor: migrate Timeline → features/analytics/ [34/71]
```
