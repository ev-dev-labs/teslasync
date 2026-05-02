import { useMemo, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useChargingSessionsPaginated } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Select } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import {
  SummaryStatsGrid,
  SessionCurveChart,
  SessionDetailPanel,
  SessionComparisonChart,
  ChargerTypeChart,
  SpeedTrendChart,
  TimeToChargeSection,
  LoadingSkeleton,
} from '../components/charging-curve';
import { sessionLabel, generateChargingCurve, avg } from '../components/charging-curve/helpers';
import type { SummaryStats } from '../components/charging-curve/types';

export default function ChargingCurvePage() {
  const { t } = useTranslation();
  useSettings();
  usePageTitle(t('charging.curve.title', 'Charging Curve'));

  /* ── Vehicle & Session selection ─────────────────────────────────────── */

  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<number | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);

  const activeVehicleId = vehicleId ?? vehicles?.[0]?.id ?? null;

  const { data: sessions, isLoading } = useChargingSessionsPaginated(activeVehicleId, {
    limit: 200,
  });

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const sessionOptions = useMemo(
    () =>
      (sessions ?? []).map((s) => ({
        value: String(s.id),
        label: sessionLabel(s),
      })),
    [sessions],
  );

  const handleVehicleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const id = Number(e.target.value);
    setVehicleId(id);
    setSelectedSessionId(null);
  };

  const handleSessionChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSelectedSessionId(Number(e.target.value) || null);
  };

  /* ── Computed Data ───────────────────────────────────────────────────── */

  const stats = useMemo((): SummaryStats | null => {
    if (!sessions?.length) return null;
    const totalEnergy = sessions.reduce((sum, s) => sum + (s.energy_added_kwh ?? 0), 0);
    const totalCost = sessions.reduce((sum, s) => sum + (s.cost ?? 0), 0);
    const avgDuration = avg(sessions.map((s) => s.duration_min));
    const powers = sessions.map((s) => s.charger_power_kw_max ?? 0);
    const avgRate = avg(powers);
    const peakRate = Math.max(...powers);
    return {
      totalSessions: sessions.length,
      totalEnergy,
      avgRate,
      peakRate,
      avgDuration,
      totalCost,
    };
  }, [sessions]);

  const selectedSession = useMemo(
    () => sessions?.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const curveData = useMemo(
    () => (selectedSession ? generateChargingCurve(selectedSession) : []),
    [selectedSession],
  );

  const currencySymbol = '$';

  /* ── Render ──────────────────────────────────────────────────────────── */

  if (isLoading) {
    return (
      <FadeIn>
        <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
          <LoadingSkeleton />
        </div>
      </FadeIn>
    );
  }

  const isEmpty = !sessions || sessions.length === 0;

  if (isEmpty) {
    return (
      <FadeIn>
        <div className="mx-auto max-w-7xl px-4 py-6">
          <h1 className="text-2xl font-bold text-white">
            {t('charging.curve.title', 'Charging Curve')}
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
          </p>

          {vehicleOptions.length > 1 && (
            <div className="mt-4">
              <Select
                value={String(activeVehicleId ?? '')}
                onChange={handleVehicleChange}
                options={vehicleOptions}
                placeholder={t('charging.selectVehicle', 'Select vehicle')}
                className="w-48"
              />
            </div>
          )}

          <GlassPanel className="mt-8 flex flex-col items-center justify-center py-16">
            <p className="text-lg font-medium text-white/70">
              {t('charging.curve.empty', 'No charging sessions to plot a curve.')}
            </p>
            <p className="mt-2 text-sm text-white/40">
              {t(
                'charging.curve.emptyHint',
                'Start a charging session and data will appear here.',
              )}
            </p>
          </GlassPanel>
        </div>
      </FadeIn>
    );
  }

  return (
    <PageContainer
      title={t('charging.curve.title', 'Charging Curve')}
      subtitle={t('charging.curve.subtitle', 'Power vs state-of-charge across sessions')}
      actions={
        vehicleOptions.length > 1 ? (
          <Select
            value={String(activeVehicleId ?? '')}
            onChange={handleVehicleChange}
            options={vehicleOptions}
            placeholder={t('charging.selectVehicle', 'Select vehicle')}
            className="w-48"
          />
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* Session Selector */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={String(selectedSessionId ?? '')}
            onChange={handleSessionChange}
            options={sessionOptions}
            placeholder={t('charging.curve.selectSession', 'Select a session to inspect')}
            className="w-full sm:w-96"
          />
          {selectedSession && (
            <span className="text-xs text-white/50">
              {formatDateTime(selectedSession.start_ts)}
              {selectedSession.charger_location && ` · ${selectedSession.charger_location}`}
            </span>
          )}
        </div>

        {/* Summary Stats */}
        <SummaryStatsGrid stats={stats} currencySymbol={currencySymbol} />

        {/* Single Session Curve + Detail Sidebar */}
        <FadeIn delay={0.1}>
          {selectedSession ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3" data-tour="charging-curve">
              <div className="lg:col-span-2">
                <SessionCurveChart curveData={curveData} />
              </div>
              <SessionDetailPanel session={selectedSession} currencySymbol={currencySymbol} />
            </div>
          ) : (
            <GlassPanel className="flex h-48 items-center justify-center" data-tour="charging-curve">
              <p className="text-sm text-white/40">
                {t(
                  'charging.curve.selectSessionHint',
                  'Select a session above to view its charging curve',
                )}
              </p>
            </GlassPanel>
          )}
        </FadeIn>

        {/* Session Comparison */}
        <SessionComparisonChart sessions={sessions} />

        {/* Charger Type + Speed Trend (side by side) */}
        <FadeIn delay={0.2}>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChargerTypeChart sessions={sessions} />
            <SpeedTrendChart sessions={sessions} />
          </div>
        </FadeIn>

        {/* Time-to-Charge Analysis */}
        <TimeToChargeSection sessions={sessions} />
      </div>
    </PageContainer>
  );
}
