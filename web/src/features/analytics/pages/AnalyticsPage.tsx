import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap, BarChart3, Battery } from 'lucide-react';
import { PageLayout } from '@/components/layout';
import { Button, Icon, Text } from '@/components/ui';
import { DataSourceNotice, DataStateNotice } from '@/components/feedback';
import { useRangeState } from '@/hooks/useRangeState';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { usePageTitle } from '@/hooks/usePageTitle';
import {
  OverviewTab, DrivingTab, ChargingTab, BatteryTab,
  type TabKey,
} from '../components/analytics';
import { FleetOverviewBrief } from '../components/operationalbrief-a-m/FleetOverviewBrief';
import { AnalyticsWorkspace, retainFleetContent } from '../components/overview-modernization';

export default function AnalyticsPage() {
  const { t } = useTranslation();
  usePageTitle(t('analytics.title', 'Fleet analytics'));

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { start, end, startInstant, endInstantExclusive } = useRangeState();

  const fleetQuery = useFleetAnalytics({ start: startInstant, end: endInstantExclusive });
  const contentQuery = retainFleetContent(fleetQuery);
  const briefQuery = contentQuery.sourceQuery ?? contentQuery;

  const tabs = useMemo(
    () => [
      { key: 'overview' as const, label: t('analytics.tabs.overview', 'Overview'), icon: <Icon icon={BarChart3} aria-hidden /> },
      { key: 'driving' as const, label: t('analytics.tabs.driving', 'Driving'), icon: <Icon icon={Car} aria-hidden /> },
      { key: 'charging' as const, label: t('analytics.tabs.charging', 'Charging'), icon: <Icon icon={Zap} aria-hidden /> },
      { key: 'battery' as const, label: t('analytics.tabs.battery', 'Battery'), icon: <Icon icon={Battery} aria-hidden /> },
    ],
    [t],
  );
  return (
    <PageLayout
      title={t('analytics.title', 'Fleet analytics')}
      subtitle={t('analytics.subtitle', 'Comprehensive fleet performance insights')}
      query={fleetQuery}
      busy={fleetQuery.isFetching}
    >
      <DataSourceNotice compact sources={[{
        id: 'analytics-fleet',
        label: t('analytics.title', 'Fleet analytics'),
        query: fleetQuery,
      }]} />
      {fleetQuery.data?.partial_result?.is_partial && (
        <DataStateNotice state="partial" role="status" data-testid="analytics-fleet-partial">
          <Text as="p" variant="bodySm" color="secondary">
            {t('dataState.partial.message', 'Some sources did not respond. Available results remain visible and are not treated as complete.')}
          </Text>
          {(fleetQuery.data.partial_result.reasons ?? []).map(reason => (
            <Text as="p" variant="bodySm" color="secondary" key={reason}>{reason}</Text>
          ))}
          <Button variant="ghost" size="sm" disabled={fleetQuery.isFetching}
            onClick={() => { void fleetQuery.refetch(); }}>
            {t('common.refresh', 'Refresh')}
          </Button>
        </DataStateNotice>
      )}
      <AnalyticsWorkspace
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        summary={<FleetOverviewBrief query={briefQuery} scope={`${start} – ${end}`}
          retained={briefQuery.data != null && (briefQuery.isError || briefQuery.fetchStatus === 'paused')} />}
      >
        {activeTab === 'overview' && <OverviewTab query={contentQuery} />}
        {activeTab === 'driving' && <DrivingTab query={contentQuery} />}
        {activeTab === 'charging' && <ChargingTab query={contentQuery} />}
        {activeTab === 'battery' && <BatteryTab query={contentQuery} />}
      </AnalyticsWorkspace>
    </PageLayout>
  );
}
