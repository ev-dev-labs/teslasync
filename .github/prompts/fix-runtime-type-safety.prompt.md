---
description: "Add compile-time and runtime guards to prevent 'X.slice is not a function' and similar type mismatch crashes"
---

# Fix: Runtime Type Safety — Prevent ".slice is not a function" Crashes

## Problem

The app crashes with `B.slice is not a function` (minified) when:
1. A hook expects an **array** (`Drive[]`) but the API returns an **object** (`{error: "..."}`)
2. A hook expects an **object** but the API returns `null` or `undefined`
3. Code calls `.slice()`, `.map()`, `.filter()` on data before checking its type

**Why TypeScript doesn't catch this:**
```typescript
// resilience.ts line 197 — the `as T` cast bypasses type checking
return camelCaseKeys(await res.json()) as T
//                                      ^^^^ "trust me, this is T" — TypeScript stops checking
```

## Fix 1 — Runtime Array Guard in API Client

Add a `safeResponse` validator in `web/src/lib/resilience.ts`:

After the existing `camelCaseKeys` function (around line 34), add:

```typescript
/**
 * Runtime type guard — ensures array responses are actually arrays.
 * Prevents ".slice is not a function" crashes when API returns
 * an error object instead of an expected array.
 */
function validateResponse<T>(data: unknown, expectArray: boolean): T {
  if (expectArray) {
    if (!Array.isArray(data)) {
      console.warn('[API] Expected array response, got:', typeof data, data);
      return [] as unknown as T;
    }
  }
  return data as T;
}
```

Then update the `resilientFetch` function. Change line 197 from:
```typescript
return camelCaseKeys(await res.json()) as T
```
To:
```typescript
const parsed = camelCaseKeys(await res.json())
return parsed as T
```

This alone doesn't fix it — we need to guard at the hook level too.

## Fix 2 — Safe Array Utility

Create `web/src/lib/safeArray.ts`:

```typescript
/**
 * Runtime guard that ensures a value is an array.
 * Use in hooks and pages when the API might return non-array data.
 *
 * @example
 * const drives = safeArray(data);  // Drive[] — guaranteed array
 * drives.map(d => ...)             // safe, never crashes
 */
export function safeArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  console.warn('[safeArray] Expected array, got:', typeof value);
  return [];
}

/**
 * Runtime guard for nullable objects.
 * Returns the value if it's a non-null object, otherwise returns the fallback.
 */
export function safeObject<T extends Record<string, unknown>>(
  value: T | null | undefined,
  fallback: T,
): T {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  return fallback;
}
```

Add to barrel: In `web/src/lib/` ensure it's importable as `@/lib/safeArray`.

## Fix 3 — Apply safeArray in ALL Hooks That Return Arrays

For every hook in `web/src/api/hooks/` that returns an array type, wrap the response:

```typescript
// ❌ BEFORE — crashes if API returns non-array
export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: () => request<Drive[]>(
      vehicleId ? `/drives?vehicle_id=${vehicleId}` : '/drives'
    ),
    enabled: !!vehicleId,
  });
}

// ✅ AFTER — runtime-safe with select transform
import { safeArray } from '@/lib/safeArray';

export function useDrives(vehicleId?: string) {
  return useQuery({
    queryKey: drivingKeys.drives(vehicleId),
    queryFn: () => request<Drive[]>(
      vehicleId ? `/drives?vehicle_id=${vehicleId}` : '/drives'
    ),
    enabled: !!vehicleId,
    select: safeArray,  // ← guarantees array even if API returns object
  });
}
```

**Apply this pattern to ALL hooks that expect arrays.** Scan with:
```bash
grep -n "request<.*\[\]>" web/src/api/hooks/*.ts
```

Every match needs `select: safeArray` added.

For hooks that return a single object (not array):
```typescript
// For nullable object responses, use select with fallback
select: (data) => data ?? null,  // explicit null, not undefined
```

## Fix 4 — Harden ESLint Rules

Update `web/.eslintrc.cjs` to catch unsafe patterns at lint time:

```javascript
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',  // ADD — enables type-aware rules
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',  // ADD — required for type-aware rules
  },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['off'],
    '@typescript-eslint/no-explicit-any': 'warn',           // CHANGE from 'off' to 'warn'
    '@typescript-eslint/no-unsafe-call': 'warn',             // ADD — catches .slice() on any
    '@typescript-eslint/no-unsafe-member-access': 'warn',    // ADD — catches .length on any
    '@typescript-eslint/no-unsafe-return': 'warn',           // ADD — catches returning any
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'react-hooks/exhaustive-deps': 'off',
    'prefer-const': 'warn',
  },
}
```

Key changes:
- `no-explicit-any: 'warn'` — flags `any` types that bypass safety
- `no-unsafe-call: 'warn'` — flags calling methods on `any` (catches `.slice()` on unknown)
- `no-unsafe-member-access: 'warn'` — flags property access on `any`
- `recommended-type-checked` — enables the full suite of type-aware lint rules

**Note:** This will produce many warnings initially. Fix them incrementally — the warnings
tell you exactly where runtime crashes can happen.

## Fix 5 — Page-Level Defense

In every page that uses array data, add the guard:

```typescript
// ❌ CRASHES if data is not an array
const { data } = useDrives(vehicleIdStr);
data.map(d => ...)  // 💥 if data is undefined or object

// ✅ SAFE — always an array
const { data } = useDrives(vehicleIdStr);
const drives = data ?? [];  // or safeArray(data) for extra safety
drives.map(d => ...)  // ✅ safe
```

Scan for all unsafe patterns:
```bash
# Find .map() .filter() .slice() .length calls on raw hook data
grep -n "data\.\(map\|filter\|slice\|length\|reduce\|find\|some\|every\)" web/src/features/**/*.tsx
```

Every match should be using `data ?? []` or `safeArray(data)` first.

## Verification

```bash
cd web

# 1. TypeScript
npx tsc --noEmit

# 2. ESLint (expect warnings, not errors initially)
npx eslint src/api/hooks/ --quiet 2>&1 | head -30

# 3. Check safeArray is used in hooks
grep -c "safeArray\|select:" src/api/hooks/*.ts

# 4. Check no raw .map/.slice on hook data in pages
grep -rn "\.data\.\(map\|slice\|filter\)" src/features/ --include="*.tsx" | wc -l
# Target: 0

# 5. Runtime test — open app, navigate to pages, check console for errors
echo "Open http://localhost:3000 and check browser console for errors"
```

**COMPLETION DEFINITION:**
- [ ] `safeArray.ts` utility created in `web/src/lib/`
- [ ] All array-returning hooks have `select: safeArray`
- [ ] ESLint rules hardened (`no-explicit-any: warn`, `no-unsafe-call: warn`)
- [ ] No raw `.map()/.slice()/.filter()` on potentially-undefined data in pages
- [ ] `npx tsc --noEmit` passes
- [ ] `npx eslint src/api/hooks/` runs (warnings OK, no errors)
- [ ] App loads without ".slice is not a function" crashes
