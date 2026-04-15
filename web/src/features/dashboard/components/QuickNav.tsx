import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Route, BatteryCharging, Gauge, Activity, ChevronRight } from 'lucide-react';
import { GlassPanel } from '@/components/ui/GlassPanel';

const NAV_ITEMS = [
  { to: '/drives', icon: Route, labelKey: 'nav.drives', label: 'Drives', descKey: 'nav.drivesDesc', desc: 'Trip history', color: '#00f0ff' },
  { to: '/charging', icon: BatteryCharging, labelKey: 'nav.charging', label: 'Charging', descKey: 'nav.chargingDesc', desc: 'Sessions & costs', color: '#10b981' },
  { to: '/analytics', icon: Gauge, labelKey: 'nav.analytics', label: 'Analytics', descKey: 'nav.analyticsDesc', desc: 'Fleet insights', color: '#a855f7' },
  { to: '/battery', icon: Activity, labelKey: 'nav.battery', label: 'Battery', descKey: 'nav.batteryDesc', desc: 'Health & degradation', color: '#f59e0b' },
] as const;

export function QuickNav() {
  const { t } = useTranslation('dashboard');

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {NAV_ITEMS.map((nav) => (
        <Link key={nav.to} to={nav.to} className="group">
          <GlassPanel hover className="p-4 transition-all group-hover:border-white/[0.12]">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: `${nav.color}10` }}>
                <nav.icon className="h-5 w-5" style={{ color: nav.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{t(nav.labelKey, nav.label)}</p>
                <p className="text-[10px] text-[var(--text-muted)]">{t(nav.descKey, nav.desc)}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-[var(--text-secondary)] transition-colors" />
            </div>
          </GlassPanel>
        </Link>
      ))}
    </div>
  );
}
