/**
 * Ingest X-Ray Page — per-vehicle telemetry diagnostic surface.
 *
 * Full-width modern-ui cockpit for inspecting what the ingest pipeline is
 * receiving for a single vehicle. Backed by
 * `GET /api/v1/system/ingest-xray/{vehicleID}` (router.go ~L3790) which
 * returns an `IngestXRayResponse`, laid out as a responsive bento:
 *
 *   1. Toolbar (vehicle + window + bucket + refresh) → PageContainer actions
 *   2. KPI band (aggregate summary + derived peak/avg) → XRayHeader
 *   3. Hero bento: bucketed sample-count time-series    → XRayBucketChart
 *      + top-fields-by-volume side panel                → XRayTopFields
 *   4. Detail band: per-field stats table               → XRayFieldsTable
 *
 * Each section owns its loading / empty / error state and the whole layout
 * stays visible before a vehicle is picked (an info banner is the CTA). The
 * page polls every INTERVALS.FAST so it feels live while an operator is
 * actively diagnosing a stalled pipeline; polling pauses when the browser
 * tab is hidden (`refetchIntervalInBackground:false`).
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Info, RefreshCw } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  AlertBanner,
  QueryError,
  SectionErrorBoundary,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useIngestXRay } from '@/api/hooks/useIngestXRay';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

import {
  XRayBucketChart,
  XRayControls,
  XRayFieldsTable,
  XRayHeader,
  XRayTopFields,
} from '../components/ingest-xray';

export default function IngestXRayPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.xray.pageTitle', 'Ingest X-Ray'));

  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [windowSel, setWindowSel] = useState<IngestXRayWindow>('1h');
  const [bucketSel, setBucketSel] = useState<IngestXRayBucket>('1m');

  const vehicles = useVehicles();
  const xray = useIngestXRay({
    vehicleId,
    window: windowSel,
    bucket: bucketSel,
    limit: 100,
  });

  const noVehicle = vehicleId === null;
  const fields = xray.data?.fields ?? [];
  const buckets = xray.data?.buckets ?? [];
  // Depend on the stable `refetch` identity, not the whole query object (which
  // TanStack Query returns fresh every render) — otherwise this callback is
  // re-created each render and needlessly re-renders the memoised toolbar /
  // retry children it's handed to.
  const refetch = useCallback(() => void xray.refetch(), [xray.refetch]);

  // Only surface the hard error panel when there is genuinely nothing to show.
  // After a vehicle has produced one good response, TanStack Query keeps that
  // `data` across a later failed poll, so a transient refetch error must NOT
  // blank the chart / table / top-fields. The KPI band already keeps its
  // last-good numbers on error; gating every section on "error AND no data"
  // keeps them consistent and lets the page-tier freshness chip own the
  // stale/failed signalling.
  const showError = xray.isError && xray.data === undefined;

  const actions = (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <XRayControls
        vehicles={vehicles.data ?? []}
        vehicleId={vehicleId}
        windowSel={windowSel}
        bucketSel={bucketSel}
        onVehicleChange={setVehicleId}
        onWindowChange={setWindowSel}
        onBucketChange={setBucketSel}
      />
      <Button
        variant="ghost"
        onClick={refetch}
        disabled={noVehicle || xray.isFetching}
        aria-label={t('admin.xray.actions.refresh', 'Refresh ingest X-Ray')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('admin.xray.pageTitle', 'Ingest X-Ray')}
      subtitle={t(
        'admin.xray.subtitle',
        'Per-vehicle telemetry sample counts — pick a vehicle to inspect what the ingest pipeline is receiving.',
      )}
      actions={actions}
      query={xray}
    >
      {noVehicle && (
        <AlertBanner
          variant="info"
          icon={<Info className="h-5 w-5" aria-hidden="true" />}
          title={t('admin.xray.noVehicle.title', 'Select a vehicle')}
        >
          {t(
            'admin.xray.noVehicle.message',
            'Pick a vehicle from the toolbar above to load its ingest X-Ray for the selected window.',
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <SectionErrorBoundary name="xray-kpis">
          <XRayHeader
            data={xray.data}
            loading={xray.isLoading}
            windowSel={windowSel}
            bucketSel={bucketSel}
          />
        </SectionErrorBoundary>
      </FadeIn>

      {/* 2 — Hero bento: sample-count time-series + top-fields side panel */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.xray.hero', 'Sample volume')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="xl:col-span-2">
            <SectionErrorBoundary name="xray-chart">
              {showError ? (
                <GlassPanel className="p-4 sm:p-5">
                  <QueryError error={xray.error} onRetry={refetch} />
                </GlassPanel>
              ) : (
                <XRayBucketChart buckets={buckets} loading={xray.isLoading} />
              )}
            </SectionErrorBoundary>
          </div>

          <div className="xl:col-span-1">
            <SectionErrorBoundary name="xray-top-fields">
              <XRayTopFields
                rows={fields}
                loading={xray.isLoading}
                error={showError ? xray.error : undefined}
                onRetry={refetch}
              />
            </SectionErrorBoundary>
          </div>
        </section>
      </FadeIn>

      {/* 3 — Detail band: full-width per-field statistics table */}
      <FadeIn delay={0.2}>
        <SectionErrorBoundary name="xray-fields">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.xray.panels.fields', 'Field statistics')}
            </PanelTitle>
            {showError ? (
              <QueryError error={xray.error} onRetry={refetch} />
            ) : (
              <XRayFieldsTable rows={fields} loading={xray.isLoading} />
            )}
          </GlassPanel>
        </SectionErrorBoundary>
      </FadeIn>
    </PageContainer>
  );
}
