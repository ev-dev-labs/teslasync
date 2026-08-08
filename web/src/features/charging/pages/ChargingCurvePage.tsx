import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Caption } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { RangePicker, VehicleSelect } from '@/components/forms';
import {
  SummaryStatsGrid,
  SessionCurveChart,
  SessionDetailPanel,
  SessionComparisonChart,
  ChargerTypeChart,
  SpeedTrendChart,
  TimeToChargeSection,
} from '../components/charging-curve';
import { sessionLabel, generateChargingCurve, avg, durationMinutes } from '../components/charging-curve/helpers';
import type { SummaryStats } from '../components/charging-curve/types';
import { AIChargingCurveFingerprintClustering } from '@/components/ai/AIChargingCurveFingerprintClustering';
import { AIMLChargingCurveClustering } from '@/components/ai/AIMLChargingCurveClustering';

export default function ChargingCurvePage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.curve.title', 'Charging Curve'));

  /* ── Vehicle, range & session selection ──────────────────────────────── */

  const { vehicleId } = useSelectedVehicle();
  const activeVehicleId = vehicleId ?? null;
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const { start, end, setRange, reset } = useRangeState({
    persistKey: 'charging-curve.range',
    defaultPresetId: 'all',
  });

  const sessionsQuery = useChargingSessionsPaginated(activeVehicleId, { limit: 200, start, end });
  const { data, isLoading, isError, error, refetch } = sessionsQuery;
  const sessions = data ?? [];
  const hasSessions = sessions.length > 0;

  const sessionOptions = useMemo(
    () => sessions.map((s) => ({ value: String(s.id), label: sessionLabel(s) })),
    [sessions],
  );

  const handleSessionChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(Number(e.target.value) || null);
  }, []);

  const handleRangeChange = useCallback(
    (r: { start: string; end: string }) => {
      setRange(r);
      setSelectedSessionId(null);
    },
    [setRange],
  );

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  // Session ids are globally-unique DB primary keys, so a selection made for
  // one vehicle can never match another vehicle's sessions. Reset it on every
  // vehicle switch so the inspector falls back to its hint instead of stranding
  // the <Select> on a value that is absent from the new option list.
  useEffect(() => {
    setSelectedSessionId(null);
  }, [activeVehicleId]);

  /* ── Derived data ────────────────────────────────────────────────────── */

  const stats = useMemo<SummaryStats | null>(() => {
    if (!hasSessions) return null;
    const totalEnergyWh = sessions.reduce((sum, s) => sum + (s.total_energy_added_wh ?? 0), 0);
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost_decimal ?? 0), 0);
    const avgDuration = avg(sessions.map((s) => durationMinutes(s.started_at, s.ended_at)));
    const powers = sessions.map((s) => (s.peak_power_w ?? 0) / 1000);
    return {
      totalSessions: sessions.length,
      totalEnergy: totalEnergyWh / 1000,
      avgRate: avg(powers),
      peakRate: powers.length ? Math.max(...powers) : 0,
      avgDuration,
      totalCost,
    };
  }, [sessions, hasSessions]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const curveData = useMemo(
    () => (selectedSession ? generateChargingCurve(selectedSession) : []),
    [selectedSession],
  );

  /* ── Per-section async wrappers ──────────────────────────────────────────
   * Keep every panel visible with its OWN loading / error / empty state so we
   * never gate the whole page behind a single `{data && …}` flag. `errorPanel`
   * is shared by the KPI band and `section` so a failed fetch surfaces a
   * retryable error everywhere instead of leaking a misleading all-zero KPI. */
  const errorPanel = (): ReactNode => (
    <GlassPanel className="p-4 sm:p-5">
      <QueryError
        error={error}
        onRetry={handleRetry}
        resourceName={t('charging.curve.resource', 'Charging sessions')}
      />
    </GlassPanel>
  );

  const section = (height: number, emptyMessage: string, content: () => ReactNode): ReactNode => {
    if (isError) return errorPanel();
    if (isLoading) {
      return (
        <GlassPanel className="p-4 sm:p-5">
          <Skeleton height={height} />
        </GlassPanel>
      );
    }
    if (!hasSessions) {
      return (
        <GlassPanel className="flex min-h-48 items-center justify-center p-4 sm:p-5">
          <EmptyState
            icon={<BatteryCharging className="h-8 w-8" aria-hidden="true" />}
            message={emptyMessage}
            action={{ label: t('charging.curve.resetRange', 'Reset date range'), onClick: reset }}
          />
        </GlassPanel>
      );
    }
    return content();
  };

  const emptyMsg = t('charging.curve.empty', 'No charging sessions to plot a curve.');

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('charging.curve.title', 'Charging Curve')}
      subtitle={t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
      query={sessionsQuery}
      actions={
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={handleRangeChange}
            align="end"
            triggerTestId="charging-curve-range"
          />
        </div>
      }
    >
      {/* AI narrators — opt-in, render null when ai_mode='off'. The inner
          Explain/Train buttons stay disabled until a vehicle is in scope. */}
      <FadeIn delay={0.02}>
        <div className="space-y-4">
          <AIChargingCurveFingerprintClustering vehicleId={vehicleId ?? undefined} />
          <AIMLChargingCurveClustering vehicleId={vehicleId ?? undefined} />
        </div>
      </FadeIn>

      {/* 1 — KPI band (full-width responsive metric grid) */}
      <FadeIn delay={0.05}>
        <section aria-label={t('charging.curve.summary', 'Summary metrics')}>
          {isError ? errorPanel() : <SummaryStatsGrid stats={stats} loading={isLoading} />}
        </section>
      </FadeIn>

      {/* 2 — Session selector + hero curve with detail sidebar */}
      <FadeIn delay={0.1}>
        <section
          className="space-y-4"
          data-tour="charging-curve"
          aria-label={t('charging.curve.sessionInspector', 'Session inspector')}
        >
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-sm">
                <Select
                  label={t('charging.curve.selectSessionLabel', 'Inspect session')}
                  value={String(selectedSessionId ?? '')}
                  onChange={handleSessionChange}
                  options={sessionOptions}
                  placeholder={t('charging.curve.selectSession', 'Select a session to inspect')}
                  disabled={!hasSessions}
                />
              </div>
              {selectedSession && (
                <Caption>
                  <TimeStamp value={selectedSession.started_at} />
                  {selectedSession.start_place ? ` · ${selectedSession.start_place}` : ''}
                </Caption>
              )}
            </div>
          </GlassPanel>

          {section(320, emptyMsg, () =>
            selectedSession ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="xl:col-span-2">
                  <SessionCurveChart curveData={curveData} />
                </div>
                <SessionDetailPanel session={selectedSession} />
              </div>
            ) : (
              <GlassPanel className="flex min-h-64 items-center justify-center p-4 sm:p-5">
                {/* no-action: the Inspect-session Select control sits directly above this panel and is the trigger. */}
                <EmptyState
                  icon={<BatteryCharging className="h-8 w-8" aria-hidden="true" />}
                  message={t(
                    'charging.curve.selectSessionHint',
                    'Select a session above to view its charging curve',
                  )}
                />
              </GlassPanel>
            ),
          )}
        </section>
      </FadeIn>

      {/* 3 — Session comparison (full-width band) */}
      <FadeIn delay={0.15}>
        <section aria-label={t('charging.curve.sessionComparison', 'Session Comparison')}>
          {section(300, emptyMsg, () => <SessionComparisonChart sessions={sessions} />)}
        </section>
      </FadeIn>

      {/* 4 — Charger-type + speed-trend bento (two charts side-by-side on wide) */}
      <FadeIn delay={0.2}>
        <section
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
          aria-label={t('charging.curve.chargerBreakdown', 'Charger breakdown')}
        >
          {section(280, emptyMsg, () => <ChargerTypeChart sessions={sessions} />)}
          {section(280, emptyMsg, () => <SpeedTrendChart sessions={sessions} />)}
        </section>
      </FadeIn>

      {/* 5 — Time-to-charge analysis (KPI sub-grid + yearly trend) */}
      <FadeIn delay={0.25}>
        <section aria-label={t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}>
          {section(320, emptyMsg, () => <TimeToChargeSection sessions={sessions} />)}
        </section>
      </FadeIn>
    </PageContainer>
  );
}
