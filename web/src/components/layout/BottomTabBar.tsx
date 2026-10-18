import { useTranslation } from 'react-i18next'
import { Icons } from '@/lib/icons'
import { Button } from '@/components/ui/runtime'
import { cn } from '@/lib/cn'
export const BOTTOM_TAB_PATHS = new Set(['/', '/vehicles', '/drives', '/charging', '/explore'])
export function BottomTabBar({ activeSection = 'Home', onChoose = () => undefined }: { activeSection?: string; onChoose?: (section: string | null) => void }) {
  const { t } = useTranslation()
  const tabs = [
    { section: 'Home', label: t('nav.mobileHome', 'Home'), icon: Icons.home },
    { section: 'Vehicles', label: t('nav.sidenav.mobileVehicles', 'Vehicles'), icon: Icons.vehicle },
    { section: 'Driving', label: t('nav.sidenav.mobileDriving', 'Driving'), icon: Icons.drive },
    { section: 'Charging', label: t('nav.mobileCharging', 'Charging'), icon: Icons.charging },
    { section: null, label: t('nav.mobileMore', 'More'), icon: Icons.layoutGrid },
  ]
  const primary = tabs.some(tab => tab.section === activeSection)
  return <nav aria-label={t('nav.quickNav', 'Quick navigation')} data-role="bottom-tab-bar" className="sidenav-phone-tabs safe-bottom">
    {tabs.map(({ section, label, icon: Icon }) => <Button key={label} variant="ghost" type="button" aria-label={label}
      aria-current={(section === activeSection || (section === null && !primary)) ? 'true' : undefined}
      className={cn('sidenav-phone-tab', (section === activeSection || (section === null && !primary)) && 'is-selected')}
      onClick={() => onChoose(section)}><Icon className="h-5 w-5" aria-hidden /><span>{label}</span></Button>)}
  </nav>
}
