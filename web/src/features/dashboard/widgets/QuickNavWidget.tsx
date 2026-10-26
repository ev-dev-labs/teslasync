import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { navRouteIcons } from '@/lib/navRouteIcons';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

export default function QuickNavWidget(_props: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const shortcuts = [
    { to: '/drives', label: t('nav.drives', 'Drives') },
    { to: '/charging', label: t('nav.charging', 'Charging') },
    { to: '/analytics', label: t('nav.analytics', 'Analytics') },
    { to: '/battery', label: t('nav.battery', 'Battery health') },
  ] as const;
  return (
    <WidgetShell title={t('nav.quickNav', 'Quick navigation')}>
      <nav
        aria-label={t('quickNav.label', 'Quick navigation')}
        className={cn('grid min-w-0', dashboardTokens.density.gridGap, dashboardTokens.columns[4])}
      >
        {shortcuts.map((item) => {
          const Icon = navRouteIcons[item.to];
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'group flex min-h-11 min-w-0 items-center gap-2 border border-[var(--border-subtle)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
                dashboardTokens.radius.inner,
                dashboardTokens.density.itemPadding,
              )}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-[var(--text-muted)]" />
              <Text as="p" variant="bodySm" className="min-w-0 break-words">{item.label}</Text>
            </Link>
          );
        })}
      </nav>
    </WidgetShell>
  );
}
