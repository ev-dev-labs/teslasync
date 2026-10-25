/**
 * Ingest X-Ray Page — per-vehicle telemetry diagnostic surface.
 *
 * Full-width modern-ui cockpit for inspecting what the ingest pipeline is
 * receiving for a single vehicle. Backed by
 * `GET /api/v1/system/ingest-xray/{vehicleID}` (router.go ~L3790) which
 * returns an `IngestXRayResponse`, laid out as a responsive bento:
 *
 *   1. Toolbar (vehicle + window + bucket + refresh) → PageContainer actions
 *   2. KPI band (aggregate summary + derived peak/avg) → IngestOperationalBrief
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
import { Info, RefreshCw } from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { Button, GlassPanel, Icon, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  AlertBanner,
  QueryError,
  SectionErrorBoundary,
  Skeleton,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useIngestXRay } from '@/api/hooks/useIngestXRay';
import { deriveDataState } from '@/api/dataState';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

import {
  XRayBucketChart,
  XRayControls,
  XRayFieldsTable,
  XRayTopFields,
} from '../components/ingest-xray';
import { IngestOperationalBrief } from '../components/statstrip-ingest-dlq-redis/IngestOperationalBrief';

export default function IngestXRayPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.xray.pageTitle', 'Ingest x-ray'));

  const { vehicleId, vehicles, vehiclesState, setVehicleId } = useSelectedVehicle();
  const [windowSel, setWindowSel] = useState<IngestXRayWindow>('1h');
  const [bucketSel, setBucketSel] = useState<IngestXRayBucket>('1m');

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
  const source = deriveDataState(xray);
  const showError = source.fatalError !== null;

  const actions = (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      <XRayControls
        vehicles={vehicles}
        vehicleId={vehicleId}
        windowSel={windowSel}
        bucketSel={bucketSel}
        onVehicleChange={setVehicleId}
        onWindowChange={setWindowSel}
        onBucketChange={setBucketSel}
      />
      <Button
        variant="ghost"
        className="min-h-11 min-w-11 md:min-h-10 md:min-w-10"
        onClick={refetch}
        disabled={noVehicle || xray.isFetching}
        aria-label={t('admin.xray.actions.refresh', 'Refresh ingest x-ray')}
      >
        <Icon icon={RefreshCw} />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('admin.xray.pageTitle', 'Ingest x-ray')}
      subtitle={t(
        'admin.xray.subtitle',
        'Per-vehicle telemetry sample counts — pick a vehicle to inspect what the ingest pipeline is receiving.',
      )}
      contextActions={actions}
      query={xray}
      dataSources={[{
        id: 'vehicles',
        label: t('dataSources.labels.vehicleRegistry', 'Vehicle registry'),
        query: {
          data: vehiclesState.data,
          error: vehiclesState.fatalError ?? vehiclesState.refreshError,
          isError: vehiclesState.fatalError !== null || vehiclesState.refreshError !== null,
          isPending: !vehiclesState.hasData,
          isLoading: vehiclesState.status === 'initial' && !vehiclesState.isRefreshBlocked,
          isFetching: vehiclesState.isRefreshing,
          fetchStatus: vehiclesState.isRefreshBlocked ? 'paused' : 'idle',
          refetch: vehiclesState.retry ?? undefined,
        },
      }, {
        id: 'ingest-xray',
        label: t('admin.xray.pageTitle', 'Ingest x-ray'),
        query: xray,
        enabled: !noVehicle,
      }]}
    >
      {!vehiclesState.hasData && !vehiclesState.fatalError && (
        <LayoutCard title={t('dataSources.labels.vehicleRegistry', 'Vehicle registry')}>
          <div role="status">
            <Text color="secondary">
              {vehiclesState.isRefreshBlocked
                ? t('dataSources.status.paused', 'Refresh paused')
                : t('common.loading', 'Loading...')}
            </Text>
            <Skeleton lines={2} />
          </div>
        </LayoutCard>
      )}
      {noVehicle && vehiclesState.hasData && (
        <AlertBanner
          variant="info"
          icon={<Icon icon={Info} size="lg" />}
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
          <IngestOperationalBrief
            data={xray.data}
            loading={!noVehicle && source.status === 'initial'}
            retained={source.hasData && source.status === 'stale'}
            enabled={!noVehicle}
            error={source.fatalError}
            windowSel={windowSel}
            bucketSel={bucketSel}
          />
        </SectionErrorBoundary>
      </FadeIn>

      {/* 2 — Hero bento: sample-count time-series + top-fields side panel */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.xray.hero', 'Sample volume')}
          className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          <div className="min-w-0 xl:col-span-2">
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

          <div className="min-w-0 xl:col-span-1">
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
          <LayoutCard title={t('admin.xray.panels.fields', 'Field statistics')}>
            {showError ? (
              <QueryError error={xray.error} onRetry={refetch} />
            ) : (
              <XRayFieldsTable rows={fields} loading={xray.isLoading} />
            )}
          </LayoutCard>
        </SectionErrorBoundary>
      </FadeIn>
    </PageLayout>
  );
}
