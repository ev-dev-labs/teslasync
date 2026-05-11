import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, AlertCircle } from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Select } from '@/components/ui/Select';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { RangePicker } from '@/components/forms';
import { FadeIn } from '@/components/motion/FadeIn';
import { VehicleTwin } from '@/components/vehicles';

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
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  /* Surface useVehicles errors via the same vehiclesError binding the
     legacy code used so the AlertBanner below keeps reporting list-load
     failures. React Query dedupes by queryKey so this is a free piggy-back. */
  const { error: vehiclesError } = useVehicles();

  /* ---- Latest security state (polled) ---- */
  const { data: latest, isLoading: loadingLatest, error: latestError } = useQuery({
    queryKey: ['security-latest', activeId],
    queryFn: () => request<SecurityEvent>(`/security/latest?vehicle_id=${activeId}`),
    enabled: !!activeId,
    refetchInterval: 5000,
  });

  /* ---- Security event history ---- */
  const { data: rawHistory = [], isLoading: loadingHistory, error: historyError } = useSecurityEvents(activeId);

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
      const t = new Date(e.createdAt).getTime();
      return t >= startMs && t <= endMs;
    });
  }, [rawHistory, start, end]);

  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = loadingLatest || loadingHistory;

  /* ---- Computed stats ---- */
  const isSecure = useMemo(() => {
    if (!latest) return true;
    return !!latest.locked && doorClosed(latest.doorState) && allWindowsClosed(latest);
  }, [latest]);

  const sentryUptime = useMemo(() => computeSentryUptime(history), [history]);
  const lastLockChange = useMemo(() => findLastLockChange(history), [history]);
  const sentryBuckets = useMemo(() => buildSentryBuckets(history), [history]);
  const securityStats = useMemo(() => computeSecurityStats(history), [history]);
  const twinState = useMemo(() => buildTwinStateFromAdmin(latest ? {
    ...latest,
    sentryMode: isSentryActive(latest.sentryMode),
  } : null), [latest]);
  const timelineEvents = useMemo(() => deriveTimeline(history), [history]);

  const vehicleOptions = useMemo(
    () =>
      vehicles.map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <PageContainer
      title={t('admin.security.title', 'Security & Access')}
      subtitle={t('admin.security.subtitle', 'Lock status, sentry mode, doors, and windows')}
      loading={isLoading}
      error={null}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {vehicles.length > 0 && (
            <Select
              options={vehicleOptions}
              value={activeId}
              onChange={(e) => setVehicleId(Number(e.target.value))}
            />
          )}
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="security-access-range"
          />
        </div>
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* Alert banner */}
      {!isSecure && latest && (
        <FadeIn>
          <GlassPanel className="border-red-500/30 bg-red-500/5 mb-4">
            <div className="flex items-center gap-3 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <p className="text-red-400 text-sm font-semibold">
                {t(
                  'admin.security.alert',
                  '⚠ Vehicle may not be secure — check lock, door, and window status.',
                )}
              </p>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Digital Twin */}
      {latest && (
        <FadeIn>
          <GlassPanel className="p-4 mb-6 flex items-center justify-center">
            <VehicleTwin
              {...twinState}
              size="sm"
              interactive
              vehicleId={activeId ? Number(activeId) : undefined}
            />
          </GlassPanel>
        </FadeIn>
      )}

      <SummaryStatsRow
        isSecure={isSecure}
        lastLockChange={lastLockChange}
        sentryUptime={sentryUptime}
        totalEvents={history.length}
        isLoading={loadingLatest}
      />

      <SecurityStatusCards latest={latest} isLoading={loadingLatest} />
      <WindowStatusDetail latest={latest} />
      <LiveVehicleState latest={latest} />
      <SentryModeChart sentryBuckets={sentryBuckets} />
      <SecurityStatistics securityStats={securityStats} sentryUptime={sentryUptime} isLoading={loadingHistory} />
      <EventHistoryTable history={history} isLoading={loadingHistory} />
      <EventTimeline timelineEvents={timelineEvents} />
    </PageContainer>
  );
}
