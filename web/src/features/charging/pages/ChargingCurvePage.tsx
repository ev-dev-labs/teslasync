import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/data-display/StatCard';
import { useChargingSessions } from '@/api/hooks/useCharging';
import type { ChargingSession } from '@/types/charging';

export default function ChargingCurvePage() {
  const { t } = useTranslation();
  const { data: sessions, isLoading, error } = useChargingSessions();

  const stats = sessions ? computeStats(sessions) : null;

  return (
    <PageContainer
      title={t('Charging Curve')}
      subtitle="Power vs state-of-charge across sessions"
      loading={isLoading}
      error={error as Error | null}
      empty={sessions?.length === 0}
      emptyMessage="No charging sessions to plot a curve."
    >
      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard
          label="Peak Power"
          value={stats?.peakPowerKw ?? 0}
          unit="kW"
          loading={isLoading}
        />
        <StatCard
          label="Avg Power"
          value={stats?.avgPowerKw ?? 0}
          unit="kW"
          loading={isLoading}
        />
        <StatCard
          label="Sessions Analyzed"
          value={stats?.sessionCount ?? 0}
          loading={isLoading}
        />
        <StatCard
          label="Avg Energy Added"
          value={stats?.avgEnergyKwh ?? 0}
          unit="kWh"
          loading={isLoading}
        />
      </Grid>

      <Card className="mt-6">
        <CardHeader
          title="Power vs SOC"
          subtitle="Chart placeholder — integrate charting library"
        />
        <div className="flex h-64 items-center justify-center text-sm text-gray-400">
          Charging curve chart will render here (power on Y-axis, SOC % on X-axis)
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Session Overlay"
          subtitle="Compare individual session curves"
        />
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Multi-session overlay chart placeholder
        </div>
      </Card>
    </PageContainer>
  );
}

function computeStats(sessions: ChargingSession[]) {
  if (sessions.length === 0) return { peakPowerKw: 0, avgPowerKw: 0, sessionCount: 0, avgEnergyKwh: 0 };
  const peakPowerKw = Math.max(...sessions.map((s) => s.maxPowerKw));
  const avgPowerKw = Math.round(
    sessions.reduce((sum, s) => sum + s.maxPowerKw, 0) / sessions.length,
  );
  const avgEnergyKwh = +(
    sessions.reduce((sum, s) => sum + s.energyAddedKwh, 0) / sessions.length
  ).toFixed(1);

  return { peakPowerKw, avgPowerKw, sessionCount: sessions.length, avgEnergyKwh };
}
