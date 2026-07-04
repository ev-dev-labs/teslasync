import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ShieldAlert } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { AlertBanner } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSecurityEvents } from '@/api/hooks/useAdmin';
import { getErrorMessage } from '@/lib/errorMessage';
import { buildTwinStateFromAdmin } from '@/lib/vehicleState';
import { request } from '@/api/client';
import type { SecurityEvent } from '@/types/admin';

import {
  doorClosed,
  allWindowsClosed,
  isSentryActive,
  computeSentryUptime,
  findLastLockChange,
  buildSentryBuckets,
  computeSecurityStats,
  deriveTimeline,
} from '../components/security-access/helpers';

import {
  DigitalTwinPanel,
  SummaryStatsRow,
  SecurityStatusCards,
  WindowStatusDetail,
  LiveVehicleState,
  SentryModeChart,
  SecurityStatistics,
  EventHistoryTable,
  EventTimeline,
} from '../components/security-access';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SecurityAccessPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.security.title', 'Security & Access'));

  /* ---- Vehicle selection (persisted across pages) ---- */
  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  /* Surface useVehicles errors so the top banner keeps reporting fleet
     list-load failures. React Query dedupes by queryKey (free piggy-back). */
  const { error: vehiclesError } = useVehicles();

  /* ---- Latest security state (polled) ---- */
  const latestQuery = useQuery({
    queryKey: ['security-latest', activeId],
    queryFn: ({ signal }) => request<SecurityEvent>(`/security/latest?vehicle_id=${activeId}`, { signal }),
    enabled: !!activeId,
    refetchInterval: 5000,
  });
  const { data: latest, isLoading: loadingLatest, error: latestError, refetch: refetchLatest } = latestQuery;

  /* ---- Security event history ---- */
  const historyQuery = useSecurityEvents(activeId);
  const {
    data: rawHistory = [],
    isLoading: loadingHistory,
    error: historyError,
    refetch: refetchHistory,
  } = historyQuery;

  /* ---- Range filter (client-side on history) ---- */
  const { start, end, setRange } = useRangeState({
    persistKey: 'security-access.range',
    defaultPresetId: 'all',
  });
  const history = useMemo(() => {
    if (!rawHistory.length) return rawHistory;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawHistory.filter((e) => {
      if (!e.createdAt) return false;
      const ts = new Date(e.createdAt).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [rawHistory, start, end]);

  /* ---- Computed stats ---- */
  const isSecure = useMemo(() => {
    if (!latest) return true;
    return !!latest.locked && doorClosed(latest.doorState) && allWindowsClosed(latest);
  }, [latest]);

  const sentryUptime = useMemo(() => computeSentryUptime(history), [history]);
  const lastLockChange = useMemo(() => findLastLockChange(history), [history]);
  const sentryBuckets = useMemo(() => buildSentryBuckets(history), [history]);
  const securityStats = useMemo(() => computeSecurityStats(history), [history]);
  const twinState = useMemo(
    () => buildTwinStateFromAdmin(latest ? { ...latest, sentryMode: isSentryActive(latest.sentryMode) } : null),
    [latest],
  );
  const timelineEvents = useMemo(() => deriveTimeline(history), [history]);

  const twinVehicleId = activeId ? Number(activeId) : undefined;

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <PageContainer
      title={t('admin.security.title', 'Security & Access')}
      subtitle={t('admin.security.subtitle', 'Lock status, sentry mode, doors, and windows')}
      query={[latestQuery, historyQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker value={{ start, end }} onChange={setRange} align="end" triggerTestId="security-access-range" />
        </div>
      }
    >
      {vehiclesError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(vehiclesError)}
        </AlertBanner>
      )}

      {/* Contextual insecure-vehicle warning */}
      {!isSecure && latest && (
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
          <SummaryStatsRow
            isSecure={isSecure}
            lastLockChange={lastLockChange}
            sentryUptime={sentryUptime}
            totalEvents={history.length}
            isLoading={loadingLatest || loadingHistory}
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
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
            className="xl:col-span-2"
          />
          <SecurityStatistics
            securityStats={securityStats}
            sentryUptime={sentryUptime}
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
            className="xl:col-span-1"
          />
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
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
          />
          <EventTimeline
            timelineEvents={timelineEvents}
            isLoading={loadingHistory}
            error={historyError}
            onRetry={refetchHistory}
          />
        </section>
      </FadeIn>
    </PageContainer>
  );
}
