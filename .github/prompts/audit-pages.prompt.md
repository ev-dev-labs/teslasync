---
description: "AUDITOR — Verify migrated pages ACTUALLY follow standards. Run in a SEPARATE session from the agent that did the work."
---

# Page Migration Auditor — Independent Verification

## ⛔ YOU ARE THE AUDITOR, NOT THE BUILDER

You did NOT write this code. Your job is to VERIFY the work done by another agent.
You have ZERO incentive to say "looks good" — your job is to FIND problems.

**Assume the builder agent lied. Verify everything with commands. Trust output, not claims.**

---

## Run the Full Audit

### 1. Count Check — Do the numbers add up?

```bash
echo "========================================="
echo "         PAGE MIGRATION AUDIT"
echo "========================================="
echo ""

OLD=$(find web/src/pages/ -name "*.tsx" ! -name "*.test.tsx" 2>/dev/null | wc -l)
NEW=$(find web/src/features/ -name "*Page.tsx" 2>/dev/null | wc -l)
TOTAL=$((OLD + NEW))
echo "Old pages remaining:  $OLD (should be 0)"
echo "New feature pages:    $NEW (should be 71+)"
echo "Total:                $TOTAL"
echo ""

if [ "$OLD" -gt 0 ]; then
  echo "❌ FAIL: $OLD old pages still exist:"
  find web/src/pages/ -name "*.tsx" ! -name "*.test.tsx" | sort
  echo ""
fi
```

### 2. Per-Page Quality Scan — Check EVERY new page for old patterns

```bash
echo "========================================="
echo "  PER-PAGE QUALITY AUDIT"
echo "========================================="
echo ""
echo "Page | PC | Hook | i18n | Raw HTML | fetch | any | Route | Verdict"
echo "---- | -- | ---- | ---- | -------- | ----- | --- | ----- | -------"

PASS=0
FAIL=0

for f in $(find web/src/features/ -name "*Page.tsx" | sort); do
  NAME=$(basename "$f" .tsx)
  
  # Check PageContainer
  PC=$(grep -c "PageContainer" "$f" 2>/dev/null)
  
  # Check TanStack Query hook usage (useQuery, useMutation, or custom use*Hook)
  HOOK=$(grep -c "useQuery\|useMutation\|use[A-Z][a-zA-Z]*(" "$f" 2>/dev/null)
  
  # Check i18n
  I18N=$(grep -c "useTranslation\|{t(" "$f" 2>/dev/null)
  
  # Check raw HTML (BAD)
  RAW=$(grep -c "<button \|<input \|<table \|<textarea \|<select " "$f" 2>/dev/null)
  
  # Check old fetch pattern (BAD)
  FETCH=$(grep -c "fetch(\|\.get(\|\.post(\|useEffect.*=>.*\(.*set" "$f" 2>/dev/null)
  
  # Check any type (BAD)
  ANY=$(grep -c ": any\b" "$f" 2>/dev/null)
  
  # Check route exists
  ROUTE=$(grep -c "$NAME" web/src/App.tsx web/src/routes/*.tsx 2>/dev/null)
  
  # Verdict
  PROBLEMS=""
  [ "$PC" -eq 0 ] && PROBLEMS="${PROBLEMS}no-PC "
  [ "$RAW" -gt 0 ] && PROBLEMS="${PROBLEMS}raw-HTML "
  [ "$FETCH" -gt 0 ] && PROBLEMS="${PROBLEMS}old-fetch "
  [ "$ANY" -gt 0 ] && PROBLEMS="${PROBLEMS}any-type "
  [ "$ROUTE" -eq 0 ] && PROBLEMS="${PROBLEMS}no-route "
  [ "$I18N" -eq 0 ] && PROBLEMS="${PROBLEMS}no-i18n "
  
  if [ -z "$PROBLEMS" ]; then
    VERDICT="✅ PASS"
    PASS=$((PASS+1))
  else
    VERDICT="❌ $PROBLEMS"
    FAIL=$((FAIL+1))
  fi
  
  PC_S=$([ "$PC" -gt 0 ] && echo "✅" || echo "❌")
  HOOK_S=$([ "$HOOK" -gt 0 ] && echo "✅" || echo "⚠️")
  I18N_S=$([ "$I18N" -gt 0 ] && echo "✅" || echo "❌")
  RAW_S=$([ "$RAW" -eq 0 ] && echo "✅" || echo "❌($RAW)")
  FETCH_S=$([ "$FETCH" -eq 0 ] && echo "✅" || echo "❌($FETCH)")
  ANY_S=$([ "$ANY" -eq 0 ] && echo "✅" || echo "❌($ANY)")
  ROUTE_S=$([ "$ROUTE" -gt 0 ] && echo "✅" || echo "❌")
  
  echo "$NAME | $PC_S | $HOOK_S | $I18N_S | $RAW_S | $FETCH_S | $ANY_S | $ROUTE_S | $VERDICT"
done

echo ""
echo "========================================="
echo "  RESULTS: $PASS passed, $FAIL failed out of $((PASS+FAIL)) pages"
echo "========================================="
```

### 3. Shared Component Usage — Are features actually using the library?

```bash
echo ""
echo "========================================="
echo "  SHARED COMPONENT USAGE CHECK"
echo "========================================="
echo ""

echo "Imports from @/components/ in features/:"
grep -rc "from '@/components/" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Total imports:", sum}'

echo ""
echo "Direct library imports in features/ (should ALL be 0):"
echo "  recharts:       $(grep -rc "from 'recharts'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "  react-leaflet:  $(grep -rc "from 'react-leaflet'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "  framer-motion:  $(grep -rc "from 'framer-motion'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"

echo ""
echo "Raw HTML elements in features/ (should ALL be 0):"
echo "  <button>:  $(grep -rc '<button ' web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "  <input>:   $(grep -rc '<input ' web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "  <table>:   $(grep -rc '<table ' web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
echo "  <select>:  $(grep -rc '<select ' web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print sum}')"
```

### 4. API Layer — Are hooks used, not raw fetch?

```bash
echo ""
echo "========================================="
echo "  API LAYER CHECK"
echo "========================================="
echo ""

echo "TanStack Query hooks in api/hooks/:"
ls web/src/api/hooks/*.ts 2>/dev/null

echo ""
echo "Features using api/hooks/ (GOOD):"
grep -rc "from '@/api/hooks/" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Total:", sum}'

echo ""
echo "Features using old api/ directly (BAD — should be 0):"
grep -rc "from '@/api/vehicles'\|from '@/api/charging'\|from '@/api/drives'\|from '@/api/analytics'" web/src/features/ --include="*.tsx" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Total:", sum}'

echo ""
echo "fetch() calls in features/ (BAD — should be 0):"
grep -rc "fetch(" web/src/features/ --include="*.tsx" --include="*.ts" 2>/dev/null | awk -F: '{sum+=$2}END{print "  Total:", sum}'
```

### 5. Build Verification

```bash
echo ""
echo "========================================="
echo "  BUILD CHECK"  
echo "========================================="
echo ""

echo "--- TypeScript ---"
cd web && npx tsc --noEmit 2>&1 | tail -5
TS_EXIT=$?
[ $TS_EXIT -eq 0 ] && echo "✅ TypeScript: PASS" || echo "❌ TypeScript: FAIL"

echo ""
echo "--- Lint ---"
npm run lint 2>&1 | tail -5
LINT_EXIT=$?
[ $LINT_EXIT -eq 0 ] && echo "✅ Lint: PASS" || echo "❌ Lint: FAIL"

echo ""
echo "--- Build ---"
npm run build 2>&1 | tail -5
BUILD_EXIT=$?
[ $BUILD_EXIT -eq 0 ] && echo "✅ Build: PASS" || echo "❌ Build: FAIL"

echo ""
echo "--- Tests ---"
npm run test -- --run 2>&1 | tail -10
TEST_EXIT=$?
[ $TEST_EXIT -eq 0 ] && echo "✅ Tests: PASS" || echo "❌ Tests: FAIL"

cd ..
```

### 6. Backend Wiring Check

```bash
echo ""
echo "========================================="
echo "  BACKEND WIRING CHECK"
echo "========================================="
echo ""

echo "--- Go build ---"
go build ./cmd/... 2>&1 | tail -3
[ $? -eq 0 ] && echo "✅ Go build: PASS" || echo "❌ Go build: FAIL"

echo ""
echo "--- Handlers in v1/ ---"
ls internal/handler/v1/*_handler.go 2>/dev/null | wc -l
echo "(expect: 6)"

echo ""
echo "--- Services wired in main.go ---"
grep -c "svc\.\|Svc\.\|Service\." cmd/teslasync/main.go 2>/dev/null
echo "(expect: 6+)"

echo ""
echo "--- SQL outside adapters (must be 0) ---"
grep -rn "SELECT\|INSERT\|UPDATE\|DELETE" internal/app/ internal/handler/v1/ --include="*.go" 2>/dev/null | grep -v "test\|comment\|DELETE.*OPTIONS\|HTTP" | wc -l

echo ""
echo "--- Direct state changes (must be 0) ---"
grep -rn '\.FSMState\s*=\|\.State\s*=' internal/app/ internal/handler/ --include="*.go" 2>/dev/null | grep -v "test\|newState\|oldState" | wc -l
```

### 7. Generate Audit Report

```bash
echo ""
echo "========================================="
echo "  AUDIT REPORT"
echo "========================================="
echo ""
echo "Old pages remaining:          $OLD (target: 0)"
echo "New feature pages:            $NEW (target: 71+)"
echo "Pages passing quality check:  $PASS / $((PASS+FAIL))"
echo "Pages failing quality check:  $FAIL"
echo ""

if [ "$OLD" -eq 0 ] && [ "$FAIL" -eq 0 ] && [ $TS_EXIT -eq 0 ] && [ $BUILD_EXIT -eq 0 ]; then
  echo "🟢 AUDIT PASSED — Migration is complete and verified."
else
  echo "🔴 AUDIT FAILED — Issues found. See details above."
  echo ""
  echo "Action required:"
  [ "$OLD" -gt 0 ] && echo "  - Migrate remaining $OLD pages"
  [ "$FAIL" -gt 0 ] && echo "  - Fix $FAIL pages that failed quality check"
  [ $TS_EXIT -ne 0 ] && echo "  - Fix TypeScript errors"
  [ $BUILD_EXIT -ne 0 ] && echo "  - Fix build errors"
fi
```

---

## What To Do With Audit Results

### If audit PASSES 🟢
Continue to Docker build + 50-round testing.

### If audit FAILS 🔴

**Option A: Fix it yourself in this session**
For each ❌ page listed in the per-page quality scan:
1. Open the file
2. Fix the specific issue (add PageContainer, replace raw HTML, add i18n, wire route)
3. Re-run the audit for that single page

**Option B: Send the builder agent back to fix**
Copy the audit output and paste it to the builder agent session:
```
The auditor found these problems. Fix each one:
[paste the failing pages from section 2]
Then run the audit again: Execute .github/prompts/audit-pages.prompt.md
```

**Keep running the audit until it shows 🟢 AUDIT PASSED.**
