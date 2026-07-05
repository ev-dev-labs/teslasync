import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { useUnits } from '@/hooks/useUnits';
import { convertTempFromSI } from '@/lib/unitConversion';
import { fmtNumber } from '@/lib/numberFormat';
import { AnalyticsPanel } from './AnalyticsPanel';
import type { FleetAnalyticsQuery } from './constants';

export function DrivingTemperatureStats({ query }: { query: FleetAnalyticsQuery }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const tempUnit = unitPrefs.temperature;
  // backend `temperature.{inside,outside}` is °C; convertTempFromSI expects °C.
  const fromC = (c: number) => convertTempFromSI(c, tempUnit);

  const { data, isLoading, isError, error, refetch } = query;
  const err = isError ? error : undefined;
  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;
  // The backend always emits `temperature.{inside,outside}` — for a window with
  // no drives it returns a zeroed StatsSummary (`count: 0`) rather than omitting
  // the object. Treating that as "present" would render six misleading "0.0°"
  // cards and make the empty state unreachable, so gate on a real sample count.
  const insideHasData = !!insideTemp && safe(insideTemp.count) > 0;
  const outsideHasData = !!outsideTemp && safe(outsideTemp.count) > 0;

  return (
    <AnalyticsPanel
      title={t('analytics.driving.tempStats', 'Temperature Stats')}
      icon={<Thermometer className="h-4 w-4" />}
      loading={isLoading}
      error={err}
      onRetry={refetch}
      isEmpty={!insideHasData && !outsideHasData}
      emptyMessage={t('analytics.driving.noTempStats', 'No temperature stats')}
      skeletonHeight={120}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label={t('analytics.driving.insideMin', 'Inside Min')}
          value={insideHasData ? fmtNumber(fromC(safe(insideTemp?.min)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.driving.insideAvg', 'Inside Avg')}
          value={insideHasData ? fmtNumber(fromC(safe(insideTemp?.avg)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.driving.insideMax', 'Inside Max')}
          value={insideHasData ? fmtNumber(fromC(safe(insideTemp?.max)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="amber"
        />
        <MetricCard
          label={t('analytics.driving.outsideMin', 'Outside Min')}
          value={outsideHasData ? fmtNumber(fromC(safe(outsideTemp?.min)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('analytics.driving.outsideAvg', 'Outside Avg')}
          value={outsideHasData ? fmtNumber(fromC(safe(outsideTemp?.avg)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('analytics.driving.outsideMax', 'Outside Max')}
          value={outsideHasData ? fmtNumber(fromC(safe(outsideTemp?.max)), 1) : '—'}
          subtitle={tempUnit}
          icon={<Thermometer className="h-4 w-4" />}
          color="amber"
        />
      </div>
    </AnalyticsPanel>
  );
}
