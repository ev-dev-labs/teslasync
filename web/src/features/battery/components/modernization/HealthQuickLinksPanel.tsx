import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { GlassPanel, PanelTitle, Button } from '@/components/ui';

const QUICK_LINKS = [
  { to: '/battery-cells', labelKey: 'battery.links.cells', fallback: 'Battery Cells' },
  { to: '/battery-degradation', labelKey: 'battery.links.degradation', fallback: 'Degradation' },
  { to: '/energy-flow', labelKey: 'battery.links.energyFlow', fallback: 'Energy Flow' },
  { to: '/projected-range', labelKey: 'battery.links.projectedRange', fallback: 'Projected Range' },
  { to: '/vampire-drain', labelKey: 'battery.links.vampireDrain', fallback: 'Vampire Drain' },
  { to: '/sleep-efficiency', labelKey: 'battery.links.sleepEfficiency', fallback: 'Sleep Efficiency' },
] as const;

/** Navigation does not depend on an analytics measurement being available. */
export function HealthQuickLinksPanel() {
  const { t } = useTranslation();
  return (
    <GlassPanel className="min-w-0 h-full p-4 sm:p-5">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <ArrowRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('battery.links.title', 'Explore More')}
      </PanelTitle>
      <nav aria-label={t('battery.links.title', 'Explore More')} className="grid min-w-0 grid-cols-2 gap-4 md:grid-cols-3">
        {QUICK_LINKS.map(link => (
          <Link key={link.to} to={link.to}>
            <Button variant="outline" className="w-full justify-between"
              icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
              {t(link.labelKey, link.fallback)}
            </Button>
          </Link>
        ))}
      </nav>
    </GlassPanel>
  );
}
