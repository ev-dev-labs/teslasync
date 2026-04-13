---
description: "Template for building a new page. Follow every step — do not skip."
---

# New Page Template

Use this template when creating any new page in the TeslaSync frontend.

## Pre-Flight Checklist

Before writing any code:

### 1. Identify the data source
```bash
# Check what backend endpoints exist for this domain
grep -n "relevant_keyword" internal/api/router.go

# Check what hooks already exist
ls web/src/api/hooks/
grep -n "relevant_keyword" web/src/api/hooks/*.ts
```

**If the endpoint doesn't exist in `router.go` → STOP. You cannot build a page for data that doesn't exist.** Report this and suggest either:
- Adding the backend endpoint (separate task)
- Using a different existing endpoint

**If the hook doesn't exist → create it FIRST** in the appropriate `useXxx.ts` file.

### 2. Verify shared components exist
```bash
# List all available shared components
find web/src/components/ -name "index.ts" -exec cat {} \;
```

For each component your page needs:
- ✅ Exists in `components/{category}/` → use it
- ❌ Missing → create it in `components/{category}/` BEFORE building the page

### 3. Create the hook (if needed)

Add to the appropriate file in `web/src/api/hooks/`:

```typescript
// Pattern: every hook follows this structure
export function useNewThing(vehicleId?: string) {
  return useQuery({
    queryKey: ['new-thing', vehicleId],
    queryFn: () => request<NewThingData>(
      vehicleId ? `/endpoint?vehicle_id=${vehicleId}` : '/endpoint'
    ),
    enabled: !!vehicleId,  // don't fetch without vehicle
  });
}
```

**CRITICAL:** The `request()` client auto-adds `/api/v1`. Do NOT include it in the path.

## Build the Page

### File location
```
web/src/features/{domain}/pages/{PageName}Page.tsx
```

### Required structure
```tsx
import { useTranslation } from 'react-i18next';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { StatCard, MetricCard } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { useXxxHook } from '@/api/hooks/useXxx';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';

export default function NewPage() {
  const { t } = useTranslation();
  usePageTitle(t('newpage.title', 'Page Title'));

  // Vehicle selection (if applicable)
  const { data: vehicles } = useVehicles();
  const vehicleId = vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  // Data hooks
  const { data, isLoading, error } = useXxxHook(vehicleIdStr);

  return (
    <PageContainer
      title={t('newpage.title', 'Page Title')}
      subtitle={t('newpage.subtitle', 'Description')}
      loading={isLoading}
      error={error ? String(error) : null}
    >
      {/* Every section always renders — use EmptyState for no data */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h2 className="mb-4 text-lg font-semibold text-white/90">
            {t('newpage.section1', 'Section Title')}
          </h2>
          {data ? (
            <Grid cols={{ default: 1, md: 2, lg: 4 }} gap={4}>
              <StatCard label={t('newpage.metric1')} value={data.metric1 ?? '—'} />
            </Grid>
          ) : (
            <EmptyState message={t('newpage.noData', 'No data available yet')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
```

### Rules (violations will be auto-detected by code-guardian)

- ✅ PageContainer as wrapper
- ✅ useTranslation() for all strings — `t('key', 'Fallback')`
- ✅ usePageTitle() for document title
- ✅ All imports from `@/components/{category}/` barrels
- ✅ All data from `@/api/hooks/` — never fetch/useEffect
- ✅ Every section always renders (EmptyState for missing data)
- ✅ Null safety: `value ?? '—'`, `items ?? []` before .map()
- ✅ FadeIn wrappers for animation
- ✅ Tailwind only for styling (no inline `style={{}}` with var())
- ✅ snake_case query params: `vehicle_id`, not `vehicleId`

## Wire the Route

In `web/src/App.tsx`, add:
```typescript
const NewPage = lazy(() => import('./features/{domain}/pages/NewPage'));
// Inside the router:
<Route path="/new-page" element={<NewPage />} />
```

## Verify

```bash
cd web
npx tsc --noEmit                  # TypeScript must pass
grep -c "style={{" src/features/{domain}/pages/NewPage.tsx  # Should be 0 or dynamic only
grep -c "from 'recharts'" src/features/{domain}/pages/NewPage.tsx  # Must be 0
grep -c "vehicleId=" src/features/{domain}/pages/NewPage.tsx  # Must be 0
wc -l src/features/{domain}/pages/NewPage.tsx  # Should be proportional to content
```

**Not done until TypeScript passes and all checks return 0 violations.**
