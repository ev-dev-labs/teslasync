import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useRangeState } from '@/hooks/useRangeState';
import { PageLayout, CardGrid, LayoutCard } from '@/components/layout';
import { Select, Caption, HelperText } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import {
  SessionCurveChart,
  SessionDetailPanel,
  SessionComparisonChart,
  ChargerTypeChart,
  SpeedTrendChart,
  TimeToChargeSection,
} from '../components/charging-curve';
import { sessionLabel, generateChargingCurve, avg, durationMinutes } from '../components/charging-curve/helpers';
import type { SummaryStats } from '../components/charging-curve/types';
import { AIChargingCurveFingerprintClustering } from '@/components/ai';
import { AIMLChargingCurveClustering } from '@/components/ai';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import {
  CurveSourceSection,
  CurveSummary,
  chargingAvailability,
} from '../components/charging-curve-modernization';

export default function ChargingCurvePage() {
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('charging.curve.title', 'Charging Curve'));

  /* ── Vehicle, range & session selection ──────────────────────────────── */

  const { vehicleId } = useSelectedVehicle();
  const activeVehicleId = vehicleId ?? null;
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const { start, end, reset } = useRangeState({
    persistKey: 'charging-curve.range',
    defaultPresetId: 'all',
  });

  const sessionsQuery = useChargingSessionsPaginated(activeVehicleId, { limit: 200, start, end });
  const { data, refetch } = sessionsQuery;
  const sessions = data ?? [];
  const hasSessions = sessions.length > 0;
  const availability = useMemo(() => chargingAvailability(sessions), [sessions]);
  const sourceState = useDataState(sessionsQuery, {
    provenance: 'historical',
    partial: availability.partial,
    unavailable: data !== undefined && !hasSessions,
  });
  const initialLoading = activeVehicleId !== null && !sourceState.hasData
    && !sourceState.fatalError && !sourceState.isRefreshBlocked;

  const sessionOptions = useMemo(
    () => sessions.map((s) => ({ value: String(s.id), label: sessionLabel(s) })),
    [sessions, displayPrecision, displayLocale],
  );

  const handleSessionChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(Number(e.target.value) || null);
  }, []);

  const handleRetry = useCallback(() => {
    void refetch();
  }, [refetch]);

  // A vehicle or workspace-range change invalidates the selected session.
  // Reset so the inspector never points at an option outside the new result set.
  useEffect(() => {
    setSelectedSessionId(null);
  }, [activeVehicleId, end, start]);

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

  /* Each source boundary keeps its own shell; retained failures do not replace
   * charts or unset the inspector. These props never alter the query contract. */
  const sectionProps = {
    state: sourceState,
    vehicleSelected: activeVehicleId !== null,
    hasSessions,
    onResetRange: reset,
    onRetry: handleRetry,
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  return (
    <PageLayout
      title={t('charging.curve.title', 'Charging Curve')}
      subtitle={t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
      query={sessionsQuery}
      busy={sourceState.isRefreshing || initialLoading}
      className="w-full min-w-0"
    >
      <StaleRefreshWarning
        state={sourceState}
        label={t('charging.curve.resource', 'Charging sessions')}
        title={sourceState.status === 'partial'
          ? t('charging.curve.modernization.partialTitle', 'Some session measurements are incomplete')
          : sourceState.status === 'unavailable'
            ? t('charging.curve.modernization.noSessionsTitle', 'No sessions in this range')
            : undefined}
        message={sourceState.status === 'partial'
          ? t('charging.curve.modernization.partialMessage', 'Available sessions remain visible. Existing chart calculations are unchanged; missing readings and unfinished sessions may contribute zero to those calculations. Check recorded-value coverage before comparing rates.')
          : sourceState.status === 'unavailable'
            ? t('charging.curve.empty', 'No charging sessions to plot a curve.')
            : undefined}
        hideRetry={sourceState.status === 'partial' || sourceState.status === 'unavailable'}
      />
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
          <CurveSummary
            stats={stats}
            availability={availability}
            state={sourceState}
            initialLoading={initialLoading}
            onRetry={handleRetry}
          />
        </section>
      </FadeIn>

      {/* 2 — Session selector + hero curve with detail sidebar */}
      <FadeIn delay={0.1}>
        <section
          className="space-y-4"
          data-tour="charging-curve"
          aria-label={t('charging.curve.sessionInspector', 'Session inspector')}
        >
          <LayoutCard title={t('charging.curve.selectSessionLabel', 'Inspect session')}>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full min-w-0 sm:max-w-sm">
                <Select
                  label={t('charging.curve.selectSessionLabel', 'Inspect session')}
                  value={String(selectedSessionId ?? '')}
                  onChange={handleSessionChange}
                  options={sessionOptions}
                  placeholder={t('charging.curve.selectSession', 'Select a session to inspect')}
                  disabled={!hasSessions}
                  className="min-h-11"
                />
              </div>
              {selectedSession && (
                <Caption className="min-w-0 break-words">
                  <TimeStamp value={selectedSession.started_at} />
                  {selectedSession.start_place ? ` · ${selectedSession.start_place}` : ''}
                </Caption>
              )}
            </div>
          </LayoutCard>

          <HelperText>
            {t('charging.curve.modernization.modeledCurves', 'Curves are modeled from session metadata, not sampled charging telemetry.')}
          </HelperText>

          <CardGrid
            label={t('charging.curve.sessionInspector', 'Session inspector')}
            items={[
              {
                id: 'charging-curve-power',
                size: 'half',
                content: (
                  <CurveSourceSection {...sectionProps} height={320}
                    title={t('charging.curve.powerVsSoc', 'Power vs SOC')}
                    selectionRequired={!selectedSession}>
                    <SessionCurveChart curveData={curveData} />
                  </CurveSourceSection>
                ),
              },
              {
                id: 'charging-curve-details',
                size: 'third',
                content: (
                  <CurveSourceSection {...sectionProps} height={320}
                    title={t('charging.curve.sessionDetails', 'Session Details')}
                    selectionRequired={!selectedSession}>
                    {selectedSession ? <SessionDetailPanel session={selectedSession} /> : null}
                  </CurveSourceSection>
                ),
              },
            ]}
          />
        </section>
      </FadeIn>

      {/* 3 — Session comparison (full-width band) */}
      <FadeIn delay={0.15}>
        <section aria-label={t('charging.curve.sessionComparison', 'Session Comparison')}>
          <CurveSourceSection {...sectionProps} height={300}
            title={t('charging.curve.sessionComparison', 'Session Comparison')}>
            <SessionComparisonChart sessions={sessions} />
          </CurveSourceSection>
        </section>
      </FadeIn>

      {/* 4 — Charger-type + speed-trend bento (two charts side-by-side on wide) */}
      <FadeIn delay={0.2}>
        <section
          className="w-full min-w-0"
          aria-label={t('charging.curve.chargerBreakdown', 'Charger breakdown')}
        >
          <CardGrid
            label={t('charging.curve.chargerBreakdown', 'Charger breakdown')}
            items={[
              {
                id: 'charging-curve-charger-types',
                size: 'half',
                content: (
                  <CurveSourceSection {...sectionProps} height={280}
                    title={t('charging.curve.chargerType', 'Charge Rate by Charger Type')}>
                    <ChargerTypeChart sessions={sessions} />
                  </CurveSourceSection>
                ),
              },
              {
                id: 'charging-curve-speed-trend',
                size: 'half',
                content: (
                  <CurveSourceSection {...sectionProps} height={280}
                    title={t('charging.curve.speedTrend', 'Charging Speed Trend')}>
                    <SpeedTrendChart sessions={sessions} />
                  </CurveSourceSection>
                ),
              },
            ]}
          />
        </section>
      </FadeIn>

      {/* 5 — Time-to-charge analysis (KPI sub-grid + yearly trend) */}
      <FadeIn delay={0.25}>
        <section aria-label={t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}>
          <CurveSourceSection {...sectionProps} height={320}
            title={t('charging.curve.timeToCharge', 'Time-to-Charge Analysis')}>
            <TimeToChargeSection sessions={sessions} />
          </CurveSourceSection>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
