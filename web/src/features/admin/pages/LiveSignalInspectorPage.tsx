/**
 * Live Signal Inspector Page — realtime per-vehicle signal viewer.
 *
 * Polls `GET /api/v1/signals/{vehicleID}/live` every 1 s while the page is
 * visible and renders the Redis-cached snapshot as a full-width command
 * center: a KPI band, a source-layer + value-kind bento, and a filterable
 * snapshot table. The 1 s cadence is intentional — operators triaging a
 * stalled or noisy signal need near-realtime feedback.
 *
 * Polling pauses automatically when the browser tab is hidden
 * (`refetchIntervalInBackground:false` on the underlying hook), so leaving
 * the page open in a background tab does not flood the API.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, RefreshCw, Radio } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Button } from '@/components/ui';
import { PanelTitle } from '@/components/ui/Typography';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary } from '@/components/feedback';
import { LiveIndicator } from '@/components/data-display';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';

import {
  LiveSignalToolbar,
  LiveSignalKpiBand,
  LiveSignalSourceBreakdown,
  LiveSignalKindBreakdown,
  LiveSignalsTable,
  LiveSectionState,
  rowsFromResponse,
  computeStats,
  type SectionStatus,
} from '../components/live-signal-inspector';

export default function LiveSignalInspectorPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.liveSignals.pageTitle', 'Live Signal Inspector'));

  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const live = useVehicleLiveSignals(vehicleId ?? undefined, {
    refetchInterval: 1_000,
    enabled: vehicleId !== null,
  });

  const rows = useMemo(() => rowsFromResponse(live.data), [live.data]);
  const stats = useMemo(() => computeStats(rows), [rows]);

  // Each data section renders its own affordance from this single discriminator
  // rather than gating the whole page behind one `{data && …}`.
  //
  // `rows.length > 0` is deliberately evaluated BEFORE `isError`: this page
  // polls once per second, and TanStack Query keeps the last successful `data`
  // while flipping `isError`/`error` when a *background* refetch of the same
  // query key fails. Checking `isError` first would blank the whole inspector
  // to a `QueryError` on a single dropped poll, throwing away a perfectly good
  // last-known snapshot. Instead we keep the snapshot on screen and let the
  // header freshness chip (`query={live}`) surface the transient failure in
  // red — a hard error is only shown when there is nothing to fall back to.
  const status: SectionStatus =
    vehicleId === null
      ? 'no-vehicle'
      : rows.length > 0
        ? 'ready'
        : live.isLoading
          ? 'loading'
          : live.isError
            ? 'error'
            : 'empty';

  const onRetry = () => {
    void live.refetch();
  };

  const noVehicleIcon = <Radio className="h-10 w-10" aria-hidden="true" />;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <LiveSignalToolbar
        vehicles={vehicles}
        vehicleId={vehicleId}
        onChange={setVehicleId}
      />
      {vehicleId !== null && <LiveIndicator variant="compact" />}
      <Button
        variant="ghost"
        size="sm"
        onClick={onRetry}
        disabled={vehicleId === null}
        aria-label={t('admin.liveSignals.refresh', 'Refresh live snapshot')}
      >
        <RefreshCw
          className={cn('h-4 w-4', live.isFetching && 'animate-spin')}
          aria-hidden="true"
        />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('admin.liveSignals.pageTitle', 'Live Signal Inspector')}
      subtitle={t(
        'admin.liveSignals.subtitle',
        'Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.',
      )}
      actions={actions}
      query={live}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('admin.liveSignals.kpis', 'Snapshot summary')}>
          <LiveSignalKpiBand stats={stats} />
        </section>
      </FadeIn>

      {/* 2 — Bento: source-layer distribution (hero, spans 2) + value kinds */}
      <FadeIn delay={0.1}>
        <SectionErrorBoundary name="live-signal-breakdowns">
          <section
            aria-label={t('admin.liveSignals.breakdowns', 'Signal breakdowns')}
            className="grid grid-cols-1 gap-4 xl:grid-cols-3"
          >
            <LiveSignalSourceBreakdown
              stats={stats}
              status={status}
              error={live.error}
              onRetry={onRetry}
              noVehicleIcon={noVehicleIcon}
            />
            <LiveSignalKindBreakdown
              stats={stats}
              status={status}
              error={live.error}
              onRetry={onRetry}
              noVehicleIcon={noVehicleIcon}
            />
          </section>
        </SectionErrorBoundary>
      </FadeIn>

      {/* 3 — Detail band: full-width filterable snapshot table */}
      <FadeIn delay={0.2}>
        <SectionErrorBoundary name="live-signals-table">
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('admin.liveSignals.panels.snapshot', 'Live Snapshot')}
            </PanelTitle>
            <LiveSectionState
              status={status}
              error={live.error}
              onRetry={onRetry}
              skeletonHeight={320}
              noVehicleIcon={noVehicleIcon}
              noVehicleMessage={t(
                'admin.liveSignals.noVehicle.message',
                'Pick a vehicle from the selector above to start streaming its live signal cache.',
              )}
              emptyMessage={t(
                'admin.liveSignals.empty.message',
                'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
              )}
            >
              <LiveSignalsTable rows={rows} />
            </LiveSectionState>
          </GlassPanel>
        </SectionErrorBoundary>
      </FadeIn>
    </PageContainer>
  );
}
