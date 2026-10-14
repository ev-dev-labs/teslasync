import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { AlertBanner, DataStateNotice } from '@/components/feedback';

import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useLatestSecurityEvent, useSecurityEvents } from '@/api/hooks/useAdmin';
import { buildTwinStateFromAdmin } from '@/lib/vehicleState';
import { deriveDataState } from '@/api/dataState';

import {
  securityPosture,
  isSentryActive,
  computeSentryUptime,
  findLastLockChange,
  buildSentryBuckets,
  computeSecurityStats,
  deriveTimeline,
} from '../components/security-access/helpers';

import {
  DigitalTwinPanel,
  SecurityStatusCards,
  WindowStatusDetail,
  LiveVehicleState,
  SentryModeChart,
  EventHistoryTable,
  EventTimeline,
} from '../components/security-access';
import { SecurityOperationalBrief } from '../components/operationalbrief-r-z/SecurityOperationalBrief';
import { SecurityStatisticsBrief } from '../components/operationalbrief-r-z/SecurityStatisticsBrief';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SecurityAccessPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.security.title', 'Security & access'));

  /* ---- Vehicle selection (persisted across pages) ---- */
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  /* Surface useVehicles errors so the top banner keeps reporting fleet
     list-load failures. React Query dedupes by queryKey (free piggy-back). */
  const vehiclesQuery = useVehicles();

  /* ---- Latest security state (polled) ---- */
  const latestQuery = useLatestSecurityEvent(activeId);
  const { data: latest, isLoading: loadingLatest, refetch: refetchLatest } = latestQuery;
  const hasLatestReadings = latest != null && Object.entries(latest).some(
    ([key, value]) => key !== 'id' && key !== 'createdAt' && value != null,
  );
  const latestState = deriveDataState(latestQuery, {
    provenance: hasLatestReadings ? 'live' : 'unknown',
    unavailable: !hasLatestReadings,
  });
  const latestError = latestState.fatalError;

  /* ---- Security event history ---- */
  const { startInstant, endInstantExclusive, timezone } = useRangeState();
  const historyQuery = useSecurityEvents(activeId, startInstant, endInstantExclusive);
  const {
    data: rawHistory = [],
    isLoading: loadingHistory,
    refetch: refetchHistory,
  } = historyQuery;
  const historyState = deriveDataState(historyQuery, { provenance: 'historical' });
  const historyError = historyState.fatalError;
  const dataSources = useMemo(
    () => [
      {
        id: 'vehicle-registry',
        label: t('dataSources.labels.vehicleRegistry', 'Vehicle registry'),
        query: vehiclesQuery,
      },
      {
        id: 'latest-security-state',
        label: t('dataSources.labels.latestSecurityState', 'Latest security state'),
        query: latestQuery,
        enabled: activeId !== '',
      },
      {
        id: 'security-history',
        label: t('dataSources.labels.securityHistory', 'Security history'),
        query: historyQuery,
        enabled: activeId !== '',
      },
    ],
    [activeId, historyQuery, latestQuery, t, vehiclesQuery],
  );

  /* ---- Guard historical rows against the exact workspace interval ---- */
  const history = useMemo(() => {
    if (!rawHistory.length) return rawHistory;
    const startMs = new Date(startInstant).getTime();
    const endMs = new Date(endInstantExclusive).getTime();
    return rawHistory.filter((e) => {
      if (!e.createdAt) return false;
      const ts = new Date(e.createdAt).getTime();
      return ts >= startMs && ts < endMs;
    });
  }, [rawHistory, startInstant, endInstantExclusive]);

  /* ---- Computed stats ---- */
  const isSecure = useMemo(() => securityPosture(latest), [latest]);

  const sentryUptime = useMemo(() => computeSentryUptime(history), [history]);
  const lastLockChange = useMemo(() => findLastLockChange(history), [history]);
  const sentryBuckets = useMemo(() => buildSentryBuckets(history, timezone), [history, timezone]);
  const securityStats = useMemo(() => computeSecurityStats(history), [history]);
  const twinState = useMemo(
    () => buildTwinStateFromAdmin(latest ? { ...latest, sentryMode: isSentryActive(latest.sentryMode) } : null),
    [latest],
  );
  const timelineEvents = useMemo(() => deriveTimeline(history), [history]);

  const twinVehicleId = activeId ? Number(activeId) : undefined;
  const summarySource = {
    known: hasLatestReadings && historyState.hasData,
    loading: loadingLatest && loadingHistory,
    retained: [latestState, historyState].some(state => state.hasData && (state.isRefreshing || state.isRefreshBlocked || state.status === 'stale')),
    failed: latestState.fatalError != null || historyState.fatalError != null,
  };
  const historyScope = t('admin.security.brief.historyScope', 'Returned security events for vehicle {{vehicle}}, {{start}} to {{end}} (exclusive); statistics describe event samples, not a complete time-weighted history.', {
    vehicle: activeId || '—', start: startInstant, end: endInstantExclusive,
  });

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <PageLayout
      title={t('admin.security.title', 'Security & access')}
      subtitle={t('admin.security.subtitle', 'Lock status, sentry mode, doors, and Windows')}
      query={[vehiclesQuery, latestQuery, historyQuery]}
      dataSources={dataSources}
    >
      {/* Contextual insecure-vehicle warning */}
      {isSecure === false && latest && (
        <FadeIn>
          <AlertBanner
            variant="warning"
            icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
            title={t('admin.security.alertTitle', 'Vehicle may not be secure')}
          >
            {t('admin.security.alert', 'Check lock, door, and window status.')}
          </AlertBanner>
        </FadeIn>
      )}

      {/* 1 — KPI band */}
      <FadeIn>
        <section aria-label={t('admin.security.section.summary', 'Summary metrics')}>
          <SecurityOperationalBrief
            isSecure={latest ? isSecure : null}
            lastLockChange={lastLockChange}
            sentryUptime={historyState.hasData ? sentryUptime : null}
            totalEvents={historyState.hasData ? history.length : null}
            latestLoading={loadingLatest}
            historyLoading={loadingHistory}
            source={summarySource}
            start={startInstant} endExclusive={endInstantExclusive} vehicleId={activeId}
          />
        </section>
      </FadeIn>

      {/* 2 — Posture bento: digital twin (hero) + security status tiles */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('admin.security.section.posture', 'Security posture')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <DigitalTwinPanel
            twinState={twinState}
            vehicleId={twinVehicleId}
            hasData={!!latest}
            isLoading={loadingLatest}
            error={latestError}
            onRetry={refetchLatest}
            className="xl:col-span-1"
          />
          <SecurityStatusCards
            latest={latest}
            isLoading={loadingLatest}
            error={latestError}
            onRetry={refetchLatest}
            className="xl:col-span-2"
          />
        </section>
      </FadeIn>

      {/* 3 — Live state + window detail bento */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('admin.security.section.live', 'Live vehicle state')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <LiveVehicleState
            latest={latest}
            sourceState={latestState}
            isLoading={loadingLatest}
            error={latestError}
            onRetry={refetchLatest}
            className="xl:col-span-2"
          />
          <WindowStatusDetail
            latest={latest}
            isLoading={loadingLatest}
            error={latestError}
            onRetry={refetchLatest}
            className="xl:col-span-1"
          />
        </section>
      </FadeIn>

      {/* 4 — Analytics bento: sentry chart (hero) + statistics */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('admin.security.section.analytics', 'Security analytics')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <SentryModeChart
            sentryBuckets={sentryBuckets}
            sourceState={historyState}
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
            className="xl:col-span-2"
          />
          <div className="xl:col-span-1">
            {historyState.isRefreshBlocked && !historyState.hasData && (
              <DataStateNotice state="partial" title={t('dataSources.status.paused', 'Refresh paused')} />
            )}
            <SecurityStatisticsBrief
              securityStats={securityStats}
              sentryUptime={sentryUptime}
              isLoading={loadingHistory || historyState.status === 'initial'}
              error={historyError}
              onRetry={refetchHistory}
              source={{
                known: historyState.hasData,
                loading: loadingHistory || historyState.status === 'initial',
                retained: historyState.hasData && (historyState.isRefreshing || historyState.isRefreshBlocked || historyState.status === 'stale'),
                failed: historyState.fatalError != null,
              }}
              scope={historyScope}
            />
          </div>
        </section>
      </FadeIn>

      {/* 5 — Detail band bento: event history + timeline */}
      <FadeIn delay={0.25}>
        <section
          aria-label={t('admin.security.section.history', 'Security event history')}
          className="grid grid-cols-1 gap-4 2xl:grid-cols-2"
        >
          <EventHistoryTable
            history={history}
            sourceState={historyState}
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
          />
          <EventTimeline
            timelineEvents={timelineEvents}
            sourceState={historyState}
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
          />
        </section>
      </FadeIn>
    </PageLayout>
  );
}
