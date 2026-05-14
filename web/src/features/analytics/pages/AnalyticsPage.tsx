import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap, BarChart3, Battery } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { TabNav } from '@/components/ui';
import { DataFreshnessAuto } from '@/components/data-display';
import { RangePicker } from '@/components/forms';
import { useRangeState } from '@/hooks/useRangeState';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  HeroGauges, OverviewTab, DrivingTab, ChargingTab, BatteryTab,
  type TabKey,
} from '../components/analytics';

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.title', 'Fleet Analytics'));

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { start, end, setRange } = useRangeState({
    persistKey: 'analytics.range',
    defaultPresetId: '30d',
  });

  const fleetQuery = useFleetAnalytics({ start, end });
  const { data, isLoading, error } = fleetQuery;

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('analytics.tabs.overview', 'Overview'), icon: <BarChart3 className="h-4 w-4" /> },
      { key: 'driving' as const, label: t('analytics.tabs.driving', 'Driving'), icon: <Car className="h-4 w-4" /> },
      { key: 'charging' as const, label: t('analytics.tabs.charging', 'Charging'), icon: <Zap className="h-4 w-4" /> },
      { key: 'battery' as const, label: t('analytics.tabs.battery', 'Battery'), icon: <Battery className="h-4 w-4" /> },
    ],
    [t],
  );

  const headerActions = (
    <div className="flex items-center gap-3">
      <DataFreshnessAuto query={fleetQuery} />
      <RangePicker
        value={{ start, end }}
        onChange={setRange}
        presetIds={['7d', '30d', '90d', '1y', 'all']}
        align="end"
        triggerTestId="analytics-range"
      />
    </div>
  );

  return (
    <PageContainer
      title={t('analytics.title', 'Fleet Analytics')}
      subtitle={t('analytics.subtitle', 'Comprehensive fleet performance insights')}
      actions={headerActions}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
    >
      <HeroGauges data={data} />

      <div className="mt-4">
        <TabNav tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />
      </div>

      {activeTab === 'overview' && <OverviewTab data={data} />}
      {activeTab === 'driving' && <DrivingTab data={data} />}
      {activeTab === 'charging' && <ChargingTab data={data} />}
      {activeTab === 'battery' && <BatteryTab data={data} />}
    </PageContainer>
  );
}
