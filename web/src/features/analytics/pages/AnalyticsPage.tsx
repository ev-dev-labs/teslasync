import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap, BarChart3, Battery } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { useRangeState } from '@/hooks/useRangeState';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  HeroGauges, OverviewTab, DrivingTab, ChargingTab, BatteryTab,
  type TabKey,
} from '../components/analytics';
import { AnalyticsWorkspace, retainFleetContent } from '../components/overview-modernization';

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.title', 'Fleet analytics'));

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { start, end } = useRangeState({
    persistKey: 'analytics.range',
  });

  const fleetQuery = useFleetAnalytics({ start, end });
  const contentQuery = retainFleetContent(fleetQuery);

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('analytics.tabs.overview', 'Overview'), icon: <BarChart3 className="h-4 w-4" /> },
      { key: 'driving' as const, label: t('analytics.tabs.driving', 'Driving'), icon: <Car className="h-4 w-4" /> },
      { key: 'charging' as const, label: t('analytics.tabs.charging', 'Charging'), icon: <Zap className="h-4 w-4" /> },
      { key: 'battery' as const, label: t('analytics.tabs.battery', 'Battery'), icon: <Battery className="h-4 w-4" /> },
    ],
    [t],
  );
  return (
    <PageLayout
      title={t('analytics.title', 'Fleet analytics')}
      subtitle={t('analytics.subtitle', 'Comprehensive fleet performance insights')}
      query={fleetQuery}
      busy={fleetQuery.isFetching}
      dataSources={[{
        id: 'analytics-fleet',
        label: t('analytics.title', 'Fleet analytics'),
        query: fleetQuery,
      }]}
    >
      <AnalyticsWorkspace
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        summary={<HeroGauges query={contentQuery} />}
      >
        {activeTab === 'overview' && <OverviewTab query={contentQuery} />}
        {activeTab === 'driving' && <DrivingTab query={contentQuery} />}
        {activeTab === 'charging' && <ChargingTab query={contentQuery} />}
        {activeTab === 'battery' && <BatteryTab query={contentQuery} />}
      </AnalyticsWorkspace>
    </PageLayout>
  );
}
