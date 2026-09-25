import { memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { navRouteIcons } from '@/lib/navRouteIcons';

const NAV_ITEMS = [
  { to: '/drives', icon: navRouteIcons['/drives'], labelKey: 'nav.drives', label: 'Drives', descKey: 'nav.drivesDesc', desc: 'Trip history', color: '#00f0ff' },
  { to: '/charging', icon: navRouteIcons['/charging'], labelKey: 'nav.charging', label: 'Charging', descKey: 'nav.chargingDesc', desc: 'Sessions & costs', color: '#10b981' },
  { to: '/analytics', icon: navRouteIcons['/analytics'], labelKey: 'nav.analytics', label: 'Analytics', descKey: 'nav.analyticsDesc', desc: 'Fleet insights', color: '#a855f7' },
  { to: '/battery', icon: navRouteIcons['/battery'], labelKey: 'nav.battery', label: 'Battery', descKey: 'nav.batteryDesc', desc: 'Health & degradation', color: '#f59e0b' },
] as const;

function QuickNavComponent() {
  const { t } = useTranslation('dashboard');

  return (
    <nav
      aria-label={t('quickNav.label', 'Quick navigation')}
      className="grid grid-cols-2 sm:grid-cols-4 gap-3"
    >
      {NAV_ITEMS.map((item) => (
        <Link key={item.to} to={item.to} className="group">
          <GlassPanel hover className="p-4 transition-all group-hover:border-white/[0.12]">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: `${item.color}10` }}>
                <item.icon aria-hidden="true" className="h-5 w-5" style={{ color: item.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{t(item.labelKey, item.label)}</p>
                <p className="text-2xs text-[var(--text-muted)]">{t(item.descKey, item.desc)}</p>
              </div>
              <ChevronRight aria-hidden="true" className="h-4 w-4 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors" />
            </div>
          </GlassPanel>
        </Link>
      ))}
    </nav>
  );
}

// Prop-less, static shortcut grid rendered on the live dashboard (a hot
// re-render surface). Memoising keeps it from re-rendering on every parent
// telemetry tick.
export const QuickNav = memo(QuickNavComponent);
QuickNav.displayName = 'QuickNav';
