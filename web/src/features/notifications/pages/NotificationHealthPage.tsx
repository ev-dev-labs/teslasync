import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';

import { AlertFatiguePanel } from '../components/AlertFatiguePanel';
import { NotificationBurnRatePanel } from '../components/NotificationBurnRatePanel';
import { NotificationLatencyPanel } from '../components/NotificationLatencyPanel';

export default function NotificationHealthPage() {
  const { t } = useTranslation();
  const title = t('notificationHealth.title', 'Notification Health');
  usePageTitle(title);
  const { hash } = useLocation();

  useEffect(() => {
    const id = hash.slice(1);
    if (id === 'fatigue' || id === 'burn-rate' || id === 'latency') {
      document.getElementById(id)?.scrollIntoView?.();
    }
  }, [hash]);

  const sections = [
    { id: 'fatigue', label: t('alertFatigue.title', 'Alert Fatigue') },
    { id: 'burn-rate', label: t('notificationBurnRate.title', 'Notification Burn Rate') },
    { id: 'latency', label: t('notificationLatency.title', 'Notification Latency') },
  ];

  return (
    <PageContainer
      title={title}
      subtitle={t('notificationHealth.subtitle', 'Understand alert noise, delivery reliability, and delivery speed in one place.')}
    >
      <div className="space-y-8">
        <GlassPanel className="p-4 sm:p-5">
          <nav aria-label={t('notificationHealth.navigation', 'Notification health sections')} className="flex flex-wrap gap-2">
            {sections.map(({ id, label }) => (
              <a key={id} href={`#${id}`} className="rounded-shape-sm border border-[var(--border-default)] px-3 py-2 hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                <Text as="span" variant="bodySm">{label}</Text>
              </a>
            ))}
          </nav>
        </GlassPanel>
        <AlertFatiguePanel />
        <NotificationBurnRatePanel />
        <NotificationLatencyPanel />
      </div>
    </PageContainer>
  );
}
