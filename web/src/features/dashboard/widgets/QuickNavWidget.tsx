import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { navRouteIcons } from '@/lib/navRouteIcons';
import { Badge, Caption, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';

export default function QuickNavWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const compact = size.cols <= 1 && size.rows <= 1;
  const DashboardIcon = navRouteIcons['/'];
  const shortcuts = [
    { to: '/drives', label: t('nav.drives', 'Drives') },
    { to: '/charging', label: t('nav.charging', 'Charging') },
    { to: '/analytics', label: t('nav.analytics', 'Analytics') },
    { to: '/battery', label: t('nav.battery', 'Battery health') },
  ] as const;
  const navigation = (designed: boolean) => (
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
              'group flex min-h-11 min-w-0 items-center gap-2 transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]',
              dashboardTokens.radius.inner,
              dashboardTokens.density.itemPadding,
              designed && 'justify-center border border-[var(--border-subtle)] bg-[var(--surface-1)] text-center focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]',
              designed && !compact && 'min-h-20 flex-col px-2 py-3',
            )}
          >
            <Icon aria-hidden="true" className={cn(
              'size-4 shrink-0 text-[var(--text-muted)]',
              designed && !compact && 'size-5 text-[var(--theme-primary)]',
            )} />
            <Text as="p" variant="bodySm" className="min-w-0 break-words">{item.label}</Text>
          </Link>
        );
      })}
    </nav>
  );
  return (
    <WidgetShell title={t('nav.quickNav', 'Quick navigation')}>
      <InstrumentPresentation
        family="actions"
        compact={compact}
        headline={<Text as="p" variant="sectionTitle" className="break-words">{t('quickNav.shortcuts', 'Shortcuts')}</Text>}
        icon={<DashboardIcon />}
        context={<div className="flex min-w-0 items-center"><Badge variant="neutral" size="sm">{t('quickNav.dashboard', 'Dashboard')}</Badge></div>}
        instrument={navigation(true)}
        details={<Caption as="p" className="block min-w-0 break-words">{t('quickNav.telemetryIndependent', 'Navigation does not depend on telemetry freshness.')}</Caption>}
      >
        {navigation(false)}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
