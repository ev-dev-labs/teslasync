import { PrefetchLink } from './PrefetchLink';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, Car, BatteryCharging, HeartPulse, MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

interface Tab {
  path: string;
  icon: LucideIcon;
  i18nKey: string;
  fallback: string;
}

/**
 * Top-5 most-trafficked routes per MOBILE_GUIDELINES.md. Mirrors the
 * navigation a Tesla owner reaches for from their phone:
 * Dashboard → Drives → Charging → Battery → Map.
 */
const TABS: Tab[] = [
  { path: '/',         icon: Home,             i18nKey: 'nav.dashboard', fallback: 'Home' },
  { path: '/drives',   icon: Car,              i18nKey: 'nav.drives',    fallback: 'Drives' },
  { path: '/charging', icon: BatteryCharging,  i18nKey: 'nav.charging',  fallback: 'Charging' },
  { path: '/battery',  icon: HeartPulse,       i18nKey: 'nav.battery',   fallback: 'Battery' },
  { path: '/live',     icon: MapPin,           i18nKey: 'nav.liveMap',   fallback: 'Map' },
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
        bg-[var(--surface-overlay)] backdrop-blur-xl border-t border-white/[0.06]
        flex items-center justify-around px-2 h-14 safe-bottom"
    >
      {TABS.map(tab => {
        const isActive = tab.path === '/'
          ? location.pathname === '/'
          : location.pathname === tab.path || location.pathname.startsWith(tab.path + '/');
        const Icon = tab.icon;
        // Resolve once so the anchor's accessible name (aria-label) and the
        // visible caption can never drift apart — WCAG 2.5.3 (Label in Name).
        const label = t(tab.i18nKey, tab.fallback);

        return (
          <PrefetchLink
            key={tab.path}
            to={tab.path}
            aria-label={label}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-3 rounded-lg',
              'transition-colors min-w-[48px] min-h-[44px]',
              isActive
                ? 'text-[var(--theme-primary)]'
                : 'text-[var(--text-muted)] active:text-[var(--text-secondary)]'
            )}
          >
            <Icon aria-hidden="true" className={cn('h-5 w-5', isActive && 'drop-shadow-[0_0_6px_currentColor]')} />
            <span className="text-2xs font-medium leading-tight">
              {label}
            </span>
            {isActive && (
              <span className="absolute -bottom-0.5 h-0.5 w-4 rounded-full bg-[var(--theme-primary)] shadow-[0_0_6px_var(--theme-primary)]" />
            )}
          </PrefetchLink>
        );
      })}
    </nav>
  );
}
