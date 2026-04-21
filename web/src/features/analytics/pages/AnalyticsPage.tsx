import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap, BarChart3, Battery } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { Button, TabNav } from '@/components/ui';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  HeroGauges, OverviewTab, DrivingTab, ChargingTab, BatteryTab,
  TIME_RANGES,
  type TimeRange, type TabKey,
} from '../components/analytics';

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.title', 'Fleet Analytics'));

  const [days, setDays] = useState<TimeRange>('30');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const daysNum = days === 'all' ? 30 : Number(days);
  const startParam = days === 'all' ? '2015-01-01' : undefined;

  const { data, isLoading, error } = useFleetAnalytics(daysNum, startParam);

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
    <div className="flex items-center gap-1">
      {TIME_RANGES.map((r) => (
        <Button
          key={r.value}
          variant={days === r.value ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setDays(r.value)}
        >
          {r.label}
        </Button>
      ))}
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
