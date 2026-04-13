---
description: "Fix QuickStatsPage — wrap in PageContainer instead of manual loading/error handling"
---

# Fix: QuickStatsPage — Missing PageContainer

## Problem

QuickStatsPage (108 lines) uses manual loading/error returns (`if (isLoading) return ...`,
`if (error) return ...`) instead of `PageContainer` which handles these states automatically.

## Current Pattern (lines 25-55)

```typescript
if (isLoading) {
  return (<div>...skeleton...</div>);  // manual loading
}
if (error) {
  return (<div>...error...</div>);     // manual error
}
return (<div>...content...</div>);     // no PageContainer wrapper
```

## Fix

Replace the three separate return branches with a single `PageContainer`-wrapped return:

```typescript
import { PageContainer } from '@/components/layout';

export default function QuickStatsPage() {
  const { t } = useTranslation();
  usePageTitle(t('quickStats.title', 'Quick Stats'));

  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const { data: analytics, isLoading: analyticsLoading, error } = useAnalyticsSummary(30);
  const { convertDistance, distanceUnit } = useSettings();

  const isLoading = vehiclesLoading || analyticsLoading;
  const vehicle = vehicles?.[0];

  return (
    <PageContainer
      title={t('quickStats.title', 'Quick Stats')}
      loading={isLoading}
      error={error ? String(error) : null}
    >
      {/* Move the existing content here — the stats grid, vehicle info, etc. */}
      {/* Remove the manual if(isLoading)/if(error) branches */}
    </PageContainer>
  );
}
```

## Rules
- Remove all `if (isLoading) return` and `if (error) return` branches
- Wrap the main content in `<PageContainer>` with loading/error props
- Keep all existing content, metrics, and links intact
- DO NOT revert to old code patterns

## Verification

```bash
cd web
npx tsc --noEmit
grep -c "PageContainer" src/features/dashboard/pages/QuickStatsPage.tsx
# Must be ≥ 1
```
