import { useTranslation } from 'react-i18next';
import { Thermometer } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { safe } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import type { FleetAnalytics } from '@/api/types';
import { SectionTitle } from './helpers';

export function DrivingTemperatureStats({ data }: { data: FleetAnalytics | undefined }) {
  const { t } = useTranslation();
  const { convertTemp, tempUnit } = useSettings();

  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;

  return (
    <GlassPanel className="p-4">
      <SectionTitle>{t('analytics.driving.tempStats', 'Temperature Stats')}</SectionTitle>
      {insideTemp || outsideTemp ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label={t('analytics.driving.insideMin', 'Inside Min')}
            value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.min)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('analytics.driving.insideAvg', 'Inside Avg')}
            value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.avg)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('analytics.driving.insideMax', 'Inside Max')}
            value={insideTemp ? fmtNumber(convertTemp(safe(insideTemp.max)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('analytics.driving.outsideMin', 'Outside Min')}
            value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.min)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('analytics.driving.outsideAvg', 'Outside Avg')}
            value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.avg)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="green"
          />
          <MetricCard
            label={t('analytics.driving.outsideMax', 'Outside Max')}
            value={outsideTemp ? fmtNumber(convertTemp(safe(outsideTemp.max)), 1) : '—'}
            subtitle={tempUnit}
            icon={<Thermometer className="h-4 w-4" />}
            color="amber"
          />
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('analytics.driving.noTempStats', 'No temperature stats')} />
      )}
    </GlassPanel>
  );
}
