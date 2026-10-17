import { useTranslation } from 'react-i18next';
import { Car, Gauge, Zap, DollarSign } from 'lucide-react';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';
import { GlassPanel } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { StatStrip, type StatMetric, type MetricPreferences } from '@/components/data-display/stat-reference';
import { QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { formatMetric } from '@/lib/metric-reference';

interface LifetimeKeyStatsProps {
  stats: LifetimeStats | null | undefined;
  loading: boolean;
  fatalError: boolean;
  error: unknown;
  onRetry: () => void;
}

export function LifetimeKeyStats({ stats, loading, fatalError, error, onRetry }: LifetimeKeyStatsProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { fmtInt, fmtNumber, precision, locale } = useNumberFormatting();
  const { formatCurrency, currencySymbol } = useFormatting();
  const distance = stats?.total_distance_km ?? 0;
  const drives = stats?.total_drives ?? 0;
  const energy = stats?.total_energy_kwh ?? 0;
  const hasData = stats != null;

  // These three displays used global number preferences, not unitPrefs.locale.
  // Energy was explicitly kWh. Canonical inputs stay meters/Wh, with explicit
  // display-only overrides preserving those contracts rather than new defaults.
  const preferences: MetricPreferences = {
    units: { ...unitPrefs, precision, locale, energy: 'kWh' },
    currency: { kind: 'symbol', value: currencySymbol },
  };
  const descriptions = {
    drives: t('lifetime.totalDrives', 'Total drives'),
    distance: t('lifetime.totalDistance', 'Total distance'),
    energy: t('lifetime.totalEnergy', 'Total energy'),
  };
  const metrics: StatMetric[] = [
    {
      metricId: 'count', occurrenceId: 'lifetime-total-drives',
      rawValue: drives, label: descriptions.drives, description: descriptions.drives,
      context: <><Car className="inline h-4 w-4" aria-hidden="true" />{' '}
        {fmtNumber(stats?.total_driving_hours ?? 0)} {t('lifetime.hours', 'hrs')}</>,
    },
    {
      metricId: 'distance', occurrenceId: 'lifetime-total-distance',
      rawValue: distance * 1000, label: descriptions.distance, description: descriptions.distance,
      context: <Gauge className="h-4 w-4" aria-hidden="true" />,
    },
    {
      metricId: 'energy', occurrenceId: 'lifetime-total-energy',
      rawValue: energy * 1000, label: descriptions.energy, description: descriptions.energy,
      context: <><Zap className="inline h-4 w-4" aria-hidden="true" />{' '}
        {fmtInt(stats?.total_charge_sessions ?? 0)} {t('lifetime.sessions', 'sessions')}</>,
    },
  ];
  // Generic count/finite/negative-zero rules are stricter than the historical
  // fmtInt/fmtNumber calls. Keep the specialist renderer for unproved cases.
  const safeGenericInputs = Number.isSafeInteger(drives) && drives >= 0 &&
    Number.isFinite(distance * 1000) && distance >= 0 && !Object.is(distance, -0) &&
    Number.isFinite(energy * 1000) && energy >= 0 && !Object.is(energy, -0);
  // Exact display parity is also checked at the boundary. This catches
  // multiply/divide rounding edges and negative zero without approximations.
  const genericEquivalent = safeGenericInputs &&
    formatMetric('count', drives, preferences).value === fmtInt(drives) &&
    formatMetric('distance', distance * 1000, preferences).text ===
      `${fmtNumber(convertDistanceFromSI(distance * 1000, unitPrefs.distance))} ${unitPrefs.distance}` &&
    formatMetric('energy', energy * 1000, preferences).text === `${fmtNumber(energy)} kWh`;

  if (fatalError) return (
    <GlassPanel className="p-4 sm:p-5">
      <QueryError error={error} onRetry={onRetry} />
    </GlassPanel>
  );

  return (
    <div className="min-w-0 space-y-3">
      {hasData && error != null && <QueryError error={error} onRetry={onRetry} />}
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-4">
        <div className="min-w-0 xl:col-span-3">
          {genericEquivalent ? (
            <StatStrip
              id="lifetime-key-metrics"
              metrics={metrics}
              preferences={preferences}
              loading={loading && !hasData}
              retained={hasData && error != null}
              period={{
                kind: 'alltime',
                label: t('lifetime.source.allTime', 'All time'),
                provenance: t('lifetime.source.aggregate', 'Server lifetime aggregates'),
              }}
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard loading={loading && !hasData} label={descriptions.drives}
                value={fmtInt(drives)} icon={<Car className="h-4 w-4" aria-hidden="true" />}
                sublabel={`${fmtNumber(stats?.total_driving_hours ?? 0)} ${t('lifetime.hours', 'hrs')}`} />
              <StatCard loading={loading && !hasData} label={descriptions.distance}
                value={fmtNumber(convertDistanceFromSI(distance * 1000, unitPrefs.distance))}
                unit={unitPrefs.distance} icon={<Gauge className="h-4 w-4" aria-hidden="true" />} />
              <StatCard loading={loading && !hasData} label={descriptions.energy}
                value={fmtNumber(energy)} unit="kWh" icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                sublabel={`${fmtInt(stats?.total_charge_sessions ?? 0)} ${t('lifetime.sessions', 'sessions')}`} />
            </div>
          )}
        </div>
        {/* Currency has a different settings precision/locale path. Keep it. */}
        <StatCard
          loading={loading && !hasData}
          label={t('lifetime.totalSavings', 'Total savings')}
          value={formatCurrency(stats?.total_savings ?? 0)}
          icon={<DollarSign className="h-4 w-4" aria-hidden="true" />}
          sublabel={t('lifetime.vsGas', 'vs gasoline')}
        />
      </div>
    </div>
  );
}
