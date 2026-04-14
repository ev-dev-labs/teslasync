---
description: "Replace clsx with cn() in 13 files — clsx is the old utility, cn() from @/lib/cn is the standard"
---

# Fix: Replace `clsx` with `cn()` — 13 Files

## Problem

13 files still import `clsx` directly instead of using the project standard `cn()` from `@/lib/cn`.
Both do the same thing (conditional class merging), but `cn()` is the single source of truth.

## Files to Fix (13)

```
web/src/features/admin/pages/APIKeysPage.tsx:9
web/src/features/admin/pages/SecurityAccessPage.tsx:4
web/src/features/maps/pages/NavigationRoutePage.tsx:4
web/src/features/notifications/pages/AlertsPage.tsx:9
web/src/features/notifications/pages/AlertStudioPage.tsx:10
web/src/features/notifications/pages/NotificationsPage.tsx:10
web/src/features/system/pages/CommandsPage.tsx:10
web/src/features/system/pages/DataExportPage.tsx:25
web/src/features/system/pages/DataRepairPage.tsx:10
web/src/features/vehicle-systems/pages/ClimateControlPage.tsx:3
web/src/features/vehicle-systems/pages/MaintenancePage.tsx:12
web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx:8
web/src/features/vehicles/components/TelemetryPanels.tsx:8
```

## Fix (same for every file)

1. Replace the import:
```typescript
// ❌ OLD
import clsx from 'clsx';

// ✅ NEW
import { cn } from '@/lib/cn';
```

2. Replace all `clsx(` calls with `cn(`:
```typescript
// ❌ OLD
className={clsx('text-sm', isActive && 'text-white')}

// ✅ NEW
className={cn('text-sm', isActive && 'text-white')}
```

The API is identical — `cn()` wraps `clsx` internally — so it's a pure find-and-replace.

## Verification

```bash
cd web

# Must be 0
grep -rn "from 'clsx'\|import clsx" src/features/ --include="*.tsx" | wc -l

# TypeScript
npx tsc --noEmit
```

**COMPLETION DEFINITION:**
- [ ] All 13 files changed from `import clsx` to `import { cn } from '@/lib/cn'`
- [ ] All `clsx(` calls replaced with `cn(`
- [ ] Zero `clsx` imports remaining in features/
- [ ] TypeScript compiles clean
