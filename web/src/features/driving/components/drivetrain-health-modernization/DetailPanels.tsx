import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { DrivetrainHealthData, DrivingStats } from '@/types/driving';
import { CardGrid, LayoutCard } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { RecommendationsPanel } from './RecommendationsPanel';
import { SourceBoundary } from './SourceBoundary';
import { finite, healthScore, healthStatus, type Sensor, type PowerSummary } from './model';

interface Props {
  health?: DrivetrainHealthData;
  stats?: DrivingStats;
  sensors: readonly Sensor[];
  power: PowerSummary;
  healthState: DataState<unknown>;
  drivesState: DataState<unknown>;
  statsState: DataState<unknown>;
  loading: boolean;
  drivesLoading?: boolean;
  statsLoading?: boolean;
  /** Caller-owned source emptiness; unknown power readings do not imply no drives. */
  drivesEmpty?: boolean;
  statsEmpty?: boolean;
}

export function DetailPanels({
  health, stats, sensors, power, healthState, drivesState, statsState, loading,
  drivesLoading = false, statsLoading = false, drivesEmpty = false, statsEmpty = false,
}: Props) {
  const { t } = useTranslation();
  const { formatTemperature, formatPower, formatEnergy } = useUnits();
  const { fmtNumber } = useNumberFormatting();
  const status = healthStatus(health);
  const powerLabel = t('drivetrain.powerSummary', 'Power Summary');
  const statsLabel = t('drivetrain.driveStats', 'Drive Statistics');
  return <CardGrid label={t('drivetrain.modernization.detailsAndAdvice', 'Temperature, power and health recommendations')} items={[
    { id: 'temperature-details', size: 'third', content: <LayoutCard title={t('drivetrain.temperatures', 'Temperature Details')}>
      <SourceBoundary state={healthState} label={t('drivetrain.temperatures', 'Temperature Details')}
        loading={loading} empty={!health} emptyMessage={t('drivetrain.noHealth', 'No drivetrain health data available yet')}>
        <KVList items={sensors.map(sensor => ({
          label: t(sensor.labelKey, sensor.label), value: formatTemperature(sensor.value),
        }))} />
      </SourceBoundary>
    </LayoutCard> },
    { id: 'power-details', size: 'third', content: <LayoutCard title={powerLabel}>
      <div role="group" aria-label={powerLabel}
        aria-busy={drivesLoading && !drivesState.hasData && !drivesState.fatalError || undefined}>
        <SourceBoundary state={drivesState} label={powerLabel}
          loading={drivesLoading} empty={drivesEmpty} emptyMessage={t('drivetrain.noData', 'No data')}>
          <KVList items={[
            { label: t('drivetrain.peakPowerLabel', 'Peak Power'), value: formatPower(power.peakPower) },
            { label: t('drivetrain.avgPowerLabel', 'Avg Peak Power'), value: formatPower(power.avgPowerMax) },
            { label: t('drivetrain.maxRegenLabel', 'Max Regen'), value: formatPower(power.minRegenPower) },
          ]} />
          <Text as="p" variant="bodySm">{t('drivetrain.modernization.powerMethodology', 'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.')}</Text>
        </SourceBoundary>
      </div>
      <div role="group" aria-label={statsLabel}
        aria-busy={statsLoading && !statsState.hasData && !statsState.fatalError || undefined}>
        <SourceBoundary state={statsState} label={statsLabel}
          loading={statsLoading} empty={statsEmpty} emptyMessage={t('drivetrain.noStats', 'No drive statistics available yet')}>
          <KVList items={[
            { label: t('drivetrain.regenLabel', 'Total Regen'), value: formatEnergy(finite(stats?.regenEnergyWh)) },
            { label: t('drivetrain.co2Label', 'CO₂ Saved'), value: finite(stats?.co2SavedKg) != null ? `${fmtNumber(stats?.co2SavedKg ?? 0)} kg` : '—' },
          ]} />
        </SourceBoundary>
      </div>
    </LayoutCard> },
    { id: 'health-recommendations', size: 'third', content: <LayoutCard title={t('drivetrain.recommendations', 'Health Recommendations')}>
      <SourceBoundary state={healthState} label={t('drivetrain.recommendations', 'Health Recommendations')}
        loading={loading} empty={false} emptyMessage={t('drivetrain.noHealth', 'No drivetrain health data available yet')}>
        <Text as="p" variant="bodySm">{t('drivetrain.modernization.healthMethodology', 'Health temperatures are backend battery-module proxies, not direct motor measurements.')}</Text>
      </SourceBoundary>
      <RecommendationsPanel status={healthScore(health) != null ? status : null} />
    </LayoutCard> },
  ]} />;
}
