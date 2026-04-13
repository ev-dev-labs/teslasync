---
description: "Fix inline styles in 4 driving pages — replace with Tailwind, max 2 per file"
---

# Fix Driving Pages — Styles + Broken API Calls

## ⛔ TWO issues to fix: inline styles AND broken API hooks

**Branch:** `refactor/full-rewrite`

---

## CRITICAL FIX: Broken API Hooks (pages show "invalid drive ID" / "vehicle_id required")

All driving pages show errors because the TanStack Query hooks use WRONG parameter names
and WRONG endpoint URLs.

### Problem 1: `vehicleId` vs `vehicle_id`

The Go backend expects `vehicle_id` (snake_case) but the hooks send `vehicleId` (camelCase).

```bash
# Find all wrong parameter names in driving hooks
grep -n "vehicleId=" web/src/api/hooks/useDriving.ts
```

**Fix every occurrence:**
```
WRONG: /drives?vehicleId=${vehicleId}
RIGHT: /drives?vehicle_id=${vehicleId}

WRONG: /drives/score?vehicleId=${vehicleId}
RIGHT: /drives/score?vehicle_id=${vehicleId}

WRONG: /drives/stats?vehicleId=${vehicleId}
RIGHT: /drives/stats?vehicle_id=${vehicleId}

WRONG: /drives/dynamics?vehicleId=${vehicleId}
RIGHT: /drives/dynamics?vehicle_id=${vehicleId}

... same for ALL hooks in useDriving.ts
```

### Problem 2: Hooks call without `enabled` guard

When `vehicleId` is undefined (vehicles haven't loaded yet), the hook fires anyway and
the API returns an error. Add `enabled` to every hook:

```typescript
export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${vehicleId}`),
    enabled: !!vehicleId,  // ← ADD THIS to every hook
  });
}
```

### Problem 3: Verify endpoint URLs match the actual backend

```bash
# Check what the Go backend actually serves
grep -rn "\.Get\|\.Post\|\.Route" internal/handler/v1/ --include="*.go" | grep -i "drive\|score\|speed\|regen\|route\|dynamic\|drivetrain"

# Also check the OLD API routes (still running)
grep -rn "drives\|drive-score\|speed-profile\|regen\|drivetrain" internal/api/ --include="*.go" | head -20
```

Match every hook URL to an actual backend route. If the backend serves `/api/v1/drives`
but the hook calls `/drives/score`, that endpoint may not exist.

**Fix EVERY hook to use the correct backend URL and parameter name.**

### Verify API hooks work:

```bash
# Test with curl — use actual vehicle ID from your DB
VID=1  # adjust to a real vehicle ID
curl -sf "http://localhost:8080/api/v1/drives?vehicle_id=$VID" | head -c 200
curl -sf "http://localhost:8080/api/v1/drives?vehicle_id=$VID&limit=5" | head -c 200
```

---

## Fix 2: Inline Styles (4 files, each must be ≤2)

| File | Current | Target |
|------|---------|--------|
| DriveDetailPage.tsx | 8 inline styles | ≤2 |
| DrivetrainHealthPage.tsx | 3 inline styles | ≤2 |
| RouteEfficiencyPage.tsx | 4 inline styles | ≤2 |
| SpeedProfilePage.tsx | 3 inline styles | ≤2 |

---

## For EACH file:

### Step 1: Find all inline styles

```bash
FILE="DriveDetailPage.tsx"  # change for each
grep -n "style={" web/src/features/driving/pages/$FILE
```

### Step 2: Replace each one

**Static colors → Tailwind text color:**
```tsx
style={{ color: '#10b981' }}  →  className="text-emerald-500"
style={{ color: '#f59e0b' }}  →  className="text-amber-500"
style={{ color: '#a855f7' }}  →  className="text-purple-500"
style={{ color: '#00f0ff' }}  →  className="text-cyan-400"
style={{ color: '#ef4444' }}  →  className="text-red-500"
style={{ color: '#6b7280' }}  →  className="text-gray-500"
style={{ color: '#3b82f6' }}  →  className="text-blue-500"
style={{ color: '#22c55e' }}  →  className="text-green-500"
```

**Static sizes → Tailwind:**
```tsx
style={{ width: '100px' }}    →  className="w-[100px]"
style={{ height: '200px' }}   →  className="h-[200px]"
style={{ maxWidth: '300px' }} →  className="max-w-[300px]"
style={{ minHeight: '50px' }} →  className="min-h-[50px]"
```

**Static spacing → Tailwind:**
```tsx
style={{ marginTop: '16px' }}   →  className="mt-4"
style={{ padding: '8px 16px' }} →  className="px-4 py-2"
style={{ gap: '12px' }}          →  className="gap-3"
```

**Static backgrounds → Tailwind:**
```tsx
style={{ backgroundColor: '#1f2937' }} →  className="bg-gray-800"
style={{ background: 'linear-gradient(...)' }} →  className="bg-gradient-to-r from-... to-..."
```

**Truly dynamic (variable-based) → KEEP as style={{}} (these are OK):**
```tsx
// OK to keep — value comes from a variable/prop
style={{ color: chartColor }}
style={{ width: `${percentage}%` }}
style={{ strokeDashoffset: offset }}
```

### Step 3: Verify this file

```bash
COUNT=$(grep -c "style={" web/src/features/driving/pages/$FILE)
echo "$FILE: $COUNT inline styles"
# Must be ≤2
```

### Step 4: Move to next file

---

## Verification — ALL must pass

```bash
echo "=== 1. API hooks — snake_case params ==="
WRONG=$(grep -c "vehicleId=" web/src/api/hooks/useDriving.ts 2>/dev/null)
echo "  camelCase params (must be 0): $WRONG"
RIGHT=$(grep -c "vehicle_id=" web/src/api/hooks/useDriving.ts 2>/dev/null)
echo "  snake_case params: $RIGHT"

echo ""
echo "=== 2. API hooks — enabled guard ==="
HOOKS=$(grep -c "export function" web/src/api/hooks/useDriving.ts 2>/dev/null)
ENABLED=$(grep -c "enabled:" web/src/api/hooks/useDriving.ts 2>/dev/null)
echo "  Hooks: $HOOKS, with enabled: $ENABLED (should match or be close)"

echo ""
echo "=== 3. Inline styles per file (each ≤2) ==="
for f in $(find web/src/features/driving/ -name "*.tsx"); do
  COUNT=$(grep -c "style={" "$f" 2>/dev/null)
  NAME=$(basename "$f")
  if [ "$COUNT" -gt 2 ]; then echo "❌ $NAME: $COUNT"; else echo "✅ $NAME: $COUNT"; fi
done

echo ""
echo "=== 4. TypeScript ==="
cd web && npx tsc --noEmit && echo "✅ PASS" || echo "❌ FAIL"
cd ..

echo ""
echo "=== 5. Pages load in browser (manual check) ==="
echo "Open these URLs and verify NO error banners:"
echo "  http://localhost:3000/drives"
echo "  http://localhost:3000/drive-score"
echo "  http://localhost:3000/speed-profile"
echo "  http://localhost:3000/driving-dynamics"
echo "  http://localhost:3000/regen-efficiency"
```

**Zero camelCase params. All hooks have enabled guard. All files ≤2 inline styles. TS passes. Pages load without errors.**
