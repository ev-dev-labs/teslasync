import { Icons } from '@/lib/icons';
/**
 * Live Signal Inspector Page — realtime per-vehicle signal viewer.
 *
 * Polls `GET /api/v1/signals/{vehicleID}/live` every 1 s while the page is
 * visible and renders the layered live snapshot as a full-width inspector:
 * a metric summary, source-layer + value-kind breakdowns, and a filterable
 * snapshot table. The 1 s cadence is intentional — operators triaging a
 * stalled or noisy signal need near-realtime feedback.
 *
 * Polling pauses automatically when the browser tab is hidden
 * (`refetchIntervalInBackground:false` on the underlying hook), so leaving
 * the page open in a background tab does not flood the API.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { PageLayout } from '@/components/layout';
import { GlassPanel, Button, Caption, Icon, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { AlertBanner, QueryError, SectionErrorBoundary, StaleRefreshWarning } from '@/components/feedback';
import { LiveIndicator } from '@/components/data-display';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicleLiveSignals } from '@/api/hooks/useTelemetry';

import {
  LiveSignalToolbar,
  LiveSignalSourceBreakdown,
  LiveSignalKindBreakdown,
  LiveSignalsTable,
  LiveSectionState,
  rowsFromResponse,
  computeStats,
  type SectionStatus,
} from '../components/live-signal-inspector';
import { LiveSignalsOperationalBrief } from '../components/operationalbrief-h-q/LiveSignalsOperationalBrief';

export default function LiveSignalInspectorPage() {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  usePageTitle(t('admin.liveSignals.pageTitle', 'Live signal inspector'));

  const { vehicleId, vehicles, vehiclesState, setVehicleId } = useSelectedVehicle();
  const live = useVehicleLiveSignals(vehicleId ?? undefined, {
    refetchInterval: 1_000,
    enabled: vehicleId !== null,
  });

  const rows = useMemo(() => rowsFromResponse(live.data), [live.data]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const liveState = useDataState(live, { provenance: 'live', unavailable: rows.length === 0 });
  const sectionState = vehicleId === null ? vehiclesState : liveState;

  // Only a fatal first-load failure replaces the snapshot. Paused/erroring
  // refreshes keep retained rows and expose source-specific recovery.
  const status: SectionStatus =
    vehicleId === null
      ? vehiclesState.fatalError
        ? 'error'
        : vehiclesState.status === 'initial' ? 'loading' : 'no-vehicle'
      : liveState.fatalError
        ? 'error'
        : rows.length > 0
          ? liveState.status === 'stale' ? 'retained' : 'ready'
          : liveState.status === 'initial'
            ? 'loading'
            : liveState.status === 'stale' ? 'retained-empty' : 'empty';

  const onRetry = () => {
    if (vehicleId === null) vehiclesState.retry?.();
    else void live.refetch();
  };

  const noVehicleIcon = <Icon icon={Icons.radio} size="xl" className={typography.color.muted} />;

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <LiveSignalToolbar
        vehicles={vehicles}
        vehicleId={vehicleId}
        onChange={setVehicleId}
      />
      {vehicleId !== null && (
        <div
          role="group"
          aria-label={t('systemStatus.infrastructure.sseTitle', 'SSE connection')}
          className="flex flex-wrap items-center gap-2"
        >
          <Caption>{t('systemStatus.infrastructure.sseTitle', 'SSE connection')}</Caption>
          <LiveIndicator variant="compact" />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="h-11 min-w-11 md:h-9 md:min-w-0"
        onClick={onRetry}
        disabled={vehicleId === null}
        aria-label={t('admin.liveSignals.refresh', 'Refresh live snapshot')}
      >
        <Icon
          icon={Icons.refresh}
          className={cn('motion-reduce:animate-none', live.isFetching && !reduce && 'animate-spin')}
        />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('admin.liveSignals.pageTitle', 'Live signal inspector')}
      subtitle={t(
        'admin.liveSignals.brief.provenance',
        'Live signal endpoint · layered L1 / L2 / stale state',
      )}
      contextActions={actions}
      query={live}
    >
      {sectionState.status === 'initial' && sectionState.isRefreshBlocked && (
        <AlertBanner variant="warning" role="status" title={t('dataSources.status.paused', 'Refresh paused')}>
          {t('chargingPlaces.workspace.initialPaused', '{{source}} loading is paused. No data has been loaded yet.', {
            source: vehicleId === null
              ? t('devtools.overview.vehicles', 'Vehicles')
              : t('admin.liveSignals.panels.snapshot', 'Live snapshot'),
          })}
          {sectionState.retry && (
            <Button variant="secondary" size="sm" className="mt-2 min-h-11 md:min-h-9" onClick={sectionState.retry}>
              {t('common.retry', 'Retry')}
            </Button>
          )}
        </AlertBanner>
      )}
      {vehicleId !== null && vehiclesState.fatalError && (
        <QueryError error={vehiclesState.fatalError} onRetry={vehiclesState.retry ?? undefined} />
      )}
      {vehiclesState.status === 'stale' && (
        <StaleRefreshWarning state={vehiclesState} label={t('devtools.overview.vehicles', 'Vehicles')} />
      )}
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section aria-label={t('admin.liveSignals.kpis', 'Snapshot summary')}>
          <LiveSignalsOperationalBrief
            stats={stats}
            status={status}
            hasSnapshot={vehicleId !== null && live.data?.signals != null}
            vehicleId={vehicleId}
            observedAt={vehicleId !== null ? live.data?.at : undefined}
          />
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
              error={sectionState.fatalError}
              onRetry={onRetry}
              noVehicleIcon={noVehicleIcon}
            />
            <LiveSignalKindBreakdown
              stats={stats}
              status={status}
              error={sectionState.fatalError}
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
              <Icon icon={Icons.activity} className={typography.color.muted} />
              {t('admin.liveSignals.panels.snapshot', 'Live snapshot')}
            </PanelTitle>
            <LiveSectionState
              status={status}
              error={sectionState.fatalError}
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
