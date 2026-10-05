import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CardGrid, LayoutCard, Section } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { TabNav } from '@/components/ui';
import type { TabKey } from '../analytics/constants';
import { AnalyticsPlacedContent } from './AnalyticsPlacedContent';

interface AnalyticsWorkspaceProps {
  tabs: ComponentProps<typeof TabNav>['tabs'];
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  summary: ReactNode;
  children: ReactNode;
}

/**
 * One full-width allocation pipeline for the summary, domain navigation and
 * active specialist renderer. Internal chart grids retain their source layout
 * and interaction owners; no second observer/packer or workspace picker lives
 * here. Domain content remains mounted through initial loading/empty/failure.
 */
export function AnalyticsWorkspace({
  tabs, activeTab, onTabChange, summary, children,
}: AnalyticsWorkspaceProps) {
  const { t } = useTranslation();
  const navigationLabel = t('analytics.tabsNav', 'Analytics sections');
  const summaryLabel = t('analytics.hero.kpis', 'Fleet summary metrics');
  const activeLabel = tabs.find(tab => tab.key === activeTab)?.label
    ?? t('analytics.tabs.overview', 'Overview');

  return (
    <CardGrid
      label={t('analytics.title', 'Fleet analytics')}
      items={[
        {
          id: 'analytics-summary',
          size: 'full',
          content: (
            <AnalyticsPlacedContent>
              <FadeIn>
                <Section id="analytics-summary" title={summaryLabel}>
                  {summary}
                </Section>
              </FadeIn>
            </AnalyticsPlacedContent>
          ),
        },
        {
          id: 'analytics-navigation',
          size: 'full',
          content: (
            <LayoutCard title={navigationLabel}>
              <nav aria-label={navigationLabel} className="w-full min-w-0">
                <TabNav
                  tabs={tabs}
                  active={activeTab}
                  ariaLabel={navigationLabel}
                  className="[&_button]:min-h-11 [&_button]:min-w-11"
                  onChange={key => onTabChange(key as TabKey)}
                />
              </nav>
            </LayoutCard>
          ),
        },
        {
          id: 'analytics-domain',
          size: 'full',
          content: (
            <AnalyticsPlacedContent>
              <Section id="analytics-domain" title={activeLabel}>
                {children}
              </Section>
            </AnalyticsPlacedContent>
          ),
        },
      ]}
    />
  );
}
