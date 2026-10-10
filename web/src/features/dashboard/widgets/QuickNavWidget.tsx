import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { navRouteIcons } from '@/lib/navRouteIcons';
import { Caption, Text } from '@/components/ui';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function QuickNavWidget(_props: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const shortcuts = [
    { to: '/drives', label: t('nav.drives', 'Drives'), description: t('nav.drivesDesc', 'Trip history') },
    { to: '/charging', label: t('nav.charging', 'Charging'), description: t('nav.chargingDesc', 'Sessions & costs') },
    { to: '/analytics', label: t('nav.analytics', 'Analytics'), description: t('nav.analyticsDesc', 'Fleet insights') },
    { to: '/battery', label: t('nav.battery', 'Battery'), description: t('nav.batteryDesc', 'Health & degradation') },
  ] as const;
  return (
    <WidgetShell title={t('nav.quickNav', 'Quick navigation')}>
      <nav aria-label={t('quickNav.label', 'Quick navigation')} className="grid grid-cols-1 @xs:grid-cols-2 @lg:grid-cols-4 gap-3">
        {shortcuts.map((item) => {
          const Icon = navRouteIcons[item.to];
          return (
            <Link key={item.to} to={item.to} className="group flex min-w-0 items-center gap-3 rounded-lg p-2 min-h-11 transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]">
              <Icon aria-hidden="true" className="size-5 shrink-0 text-[var(--theme-primary)]" />
              <div className="min-w-0 flex-1">
                <Text as="p" variant="bodySm" className="break-words">{item.label}</Text>
                <Caption className="block break-words">{item.description}</Caption>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" />
            </Link>
          );
        })}
      </nav>
    </WidgetShell>
  );
}
