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
  { path: '/',         icon: Home,             i18nKey: 'nav.mobileHome',     fallback: 'Home' },
  { path: '/drives',   icon: Car,              i18nKey: 'nav.mobileDrives',   fallback: 'Drives' },
  { path: '/charging', icon: BatteryCharging,  i18nKey: 'nav.mobileCharging', fallback: 'Charging' },
  { path: '/battery',  icon: HeartPulse,       i18nKey: 'nav.mobileBattery',  fallback: 'Battery' },
  { path: '/live',     icon: MapPin,           i18nKey: 'nav.mobileMap',      fallback: 'Map' },
];

/** Paths shown in the bottom tab bar — used to de-emphasize sidebar duplicates on mobile */
export const BOTTOM_TAB_PATHS = new Set(TABS.map(t => t.path));

export function BottomTabBar() {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <nav
      aria-label={t('nav.quickNav', 'Quick navigation')}
      data-role="bottom-tab-bar"
      className="fixed inset-x-0 bottom-0 z-50 xl:hidden
        flex h-14 items-center justify-around border-t border-[var(--border-default)]
        bg-[var(--surface-1)] px-2 shadow-e3 dark:bg-[var(--surface-overlay)] dark:backdrop-blur-xl
        safe-bottom forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
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
              'relative flex min-h-[44px] min-w-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-shape-md px-1 py-1',
              'text-sm font-medium leading-none transition-colors duration-fast',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-primary)]',
              isActive
                ? 'bg-[rgba(var(--theme-primary-rgb),0.10)] font-semibold text-[var(--text-primary)] ring-1 ring-inset ring-[rgba(var(--theme-primary-rgb),0.20)] forced-colors:border forced-colors:border-[Highlight]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] active:bg-[var(--surface-2)]'
            )}
          >
            <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} />
            <span className="whitespace-nowrap">{label}</span>
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 h-0.5 w-6 rounded-full bg-[var(--theme-primary)] forced-colors:bg-[Highlight]"
              />
            )}
          </PrefetchLink>
        );
      })}
    </nav>
  );
}
