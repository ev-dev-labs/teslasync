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

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { SectionErrorBoundary } from '@/components/feedback';
import { LiveIndicator } from '@/components/data-display';
import { cn } from '@/lib/cn';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
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
  usePageTitle(t('admin.liveSignals.pageTitle', 'Live signal inspector'));

  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const live = useVehicleLiveSignals(vehicleId ?? undefined, {
    refetchInterval: 1_000,
    enabled: vehicleId !== null,
  });

  const rows = useMemo(() => rowsFromResponse(live.data), [live.data]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const liveState = useDataState(live, { provenance: 'live', unavailable: rows.length === 0 });

  // Only a fatal first-load failure replaces the snapshot. Paused/erroring
  // refreshes keep retained rows and expose source-specific recovery.
  const status: SectionStatus =
    vehicleId === null
      ? 'no-vehicle'
      : liveState.fatalError
        ? 'error'
        : rows.length > 0
          ? liveState.status === 'stale' ? 'retained' : 'ready'
          : live.isLoading
            ? 'loading'
            : liveState.status === 'stale' ? 'retained-empty' : 'empty';

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
    <PageLayout
      title={t('admin.liveSignals.pageTitle', 'Live signal inspector')}
      subtitle={t(
        'admin.liveSignals.subtitle',
        'Realtime view of the Redis-cached live signal snapshot. Refreshes every second while this tab is in the foreground.',
      )}
      contextActions={actions}
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
              error={liveState.fatalError}
              onRetry={onRetry}
              noVehicleIcon={noVehicleIcon}
            />
            <LiveSignalKindBreakdown
              stats={stats}
              status={status}
              error={liveState.fatalError}
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
              {t('admin.liveSignals.panels.snapshot', 'Live snapshot')}
            </PanelTitle>
            <LiveSectionState
              status={status}
              error={liveState.fatalError}
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
    </PageLayout>
  );
}
