import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
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
    {
      id: 'fatigue',
      label: t('alertFatigue.title', 'Alert Fatigue'),
      description: t('notificationHealth.overview.fatigue', 'Find noisy rules and the hours they fire.'),
      number: '01',
    },
    {
      id: 'burn-rate',
      label: t('notificationBurnRate.title', 'Notification Burn Rate'),
      description: t('notificationHealth.overview.burnRate', 'See delivery outcomes against the 99% objective.'),
      number: '02',
    },
    {
      id: 'latency',
      label: t('notificationLatency.title', 'Notification Latency'),
      description: t('notificationHealth.overview.latency', 'Inspect delivery speed and the slowest attempts.'),
      number: '03',
    },
  ];

  return (
    <PageContainer
      title={title}
      subtitle={t('notificationHealth.subtitle', 'Understand alert noise, delivery reliability, and delivery speed in one place.')}
    >
      <div className="min-w-0 space-y-10 lg:space-y-14">
        <GlassPanel className="min-w-0 overflow-hidden p-4 sm:p-6">
          <div className="mb-5 max-w-2xl">
            <Text as="p" variant="caption" className="mb-2 font-semibold uppercase tracking-widest text-cyan-400">
              {t('notificationHealth.overview.label', 'Delivery intelligence')}
            </Text>
            <Text as="p" variant="body" color="secondary">
              {t('notificationHealth.overview.description', 'Explore three independent views of notification health. Select a view to jump to its metrics, charts, and detailed breakdowns.')}
            </Text>
          </div>
          <nav aria-label={t('notificationHealth.navigation', 'Notification health sections')} className="grid min-w-0 gap-3 md:grid-cols-3">
            {sections.map(({ id, label, description, number }) => (
              <a
                key={id}
                href={`#${id}`}
                aria-label={label}
                aria-current={hash === `#${id}` ? 'location' : undefined}
                className={cn(
                  'group flex min-w-0 flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-2)] p-4 transition-colors hover:border-cyan-400/50 hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
                  hash === `#${id}` && 'border-cyan-400/60 bg-cyan-400/5',
                )}
              >
                <Text as="span" variant="caption" mono className="text-cyan-400">{number} / 03</Text>
                <Text as="span" variant="body" className="font-semibold">{label}</Text>
                <Text as="span" variant="bodySm" color="secondary" className="break-words">{description}</Text>
              </a>
            ))}
          </nav>
        </GlassPanel>
        <div className="min-w-0">
          <AlertFatiguePanel />
        </div>
        <div className="min-w-0">
          <NotificationBurnRatePanel />
        </div>
        <div className="min-w-0">
          <NotificationLatencyPanel />
        </div>
      </div>
    </PageContainer>
  );
}
