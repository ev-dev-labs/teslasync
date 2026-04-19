import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Car, Zap, Bell, Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

interface Tab {
  path: string;
  icon: LucideIcon;
  i18nKey: string;
  fallback: string;
}

const TABS: Tab[] = [
  { path: '/',          icon: Home,     i18nKey: 'nav.dashboard', fallback: 'Home' },
  { path: '/drives',    icon: Car,      i18nKey: 'nav.drives',    fallback: 'Drives' },
  { path: '/commands',  icon: Zap,      i18nKey: 'nav.commands',  fallback: 'Commands' },
  { path: '/alerts',    icon: Bell,     i18nKey: 'nav.alerts',    fallback: 'Alerts' },
  { path: '/settings',  icon: Settings, i18nKey: 'nav.settings',  fallback: 'Settings' },
];

/** Paths shown in the bottom tab bar — used to de-emphasize sidebar duplicates on mobile */
export const BOTTOM_TAB_PATHS = new Set(TABS.map(t => t.path));

export function BottomTabBar() {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.quickNav', 'Quick navigation')}
      className="fixed bottom-0 left-0 right-0 z-50 lg:hidden
        bg-black/80 backdrop-blur-xl border-t border-white/[0.06]
        flex items-center justify-around px-2 h-14 safe-bottom"
    >
      {TABS.map(tab => {
        const isActive = tab.path === '/'
          ? location.pathname === '/'
          : location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');
        const Icon = tab.icon;

        return (
          <Link
            key={tab.path}
            to={tab.path}
            aria-label={t(tab.i18nKey, tab.fallback)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 rounded-lg',
              'transition-colors min-w-[48px] min-h-[44px]',
              isActive
                ? 'text-[var(--theme-primary)]'
                : 'text-white/40 active:text-white/60'
            )}
          >
            <Icon className={cn('h-5 w-5', isActive && 'drop-shadow-[0_0_6px_currentColor]')} />
            <span className="text-[10px] font-medium leading-tight">
              {t(tab.i18nKey, tab.fallback)}
            </span>
            {isActive && (
              <span className="absolute -bottom-0.5 h-0.5 w-4 rounded-full bg-[var(--theme-primary)] shadow-[0_0_6px_var(--theme-primary)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
