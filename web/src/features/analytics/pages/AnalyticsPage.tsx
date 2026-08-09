import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Zap, BarChart3, Battery } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import { TabNav } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import { FadeIn } from '@/components/motion';
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
  });

  const fleetQuery = useFleetAnalytics({ start, end });

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
    <RangePicker
      value={{ start, end }}
      onChange={setRange}
      presetIds={['7d', '30d', '90d', '1y', 'all']}
      align="end"
      triggerTestId="analytics-range"
    />
  );

  return (
    <PageContainer
      title={t('analytics.title', 'Fleet Analytics')}
      subtitle={t('analytics.subtitle', 'Comprehensive fleet performance insights')}
      actions={headerActions}
      query={fleetQuery}
    >
      {/* 1 — KPI band: full-width responsive metric grid, self-sufficient loading */}
      <FadeIn>
        <section aria-label={t('analytics.hero.kpis', 'Fleet summary metrics')}>
          <HeroGauges query={fleetQuery} />
        </section>
      </FadeIn>

      {/* 2 — Domain switcher */}
      <nav className="mt-4" aria-label={t('analytics.tabsNav', 'Analytics sections')}>
        <TabNav tabs={tabs} active={activeTab} onChange={(k) => setActiveTab(k as TabKey)} />
      </nav>

      {/* 3 — Active domain: responsive bento of charts, tables and breakdowns */}
      {activeTab === 'overview' && <OverviewTab query={fleetQuery} />}
      {activeTab === 'driving' && <DrivingTab query={fleetQuery} />}
      {activeTab === 'charging' && <ChargingTab query={fleetQuery} />}
      {activeTab === 'battery' && <BatteryTab query={fleetQuery} />}
    </PageContainer>
  );
}
