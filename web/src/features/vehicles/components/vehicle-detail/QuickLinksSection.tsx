import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Route, BatteryCharging, Battery, Thermometer, BarChart3, Settings, ChevronRight,
} from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { cn } from '@/lib/cn'

export function QuickLinksSection() {
  const { t } = useTranslation()

  const quickLinks = [
    { label: t('nav.drives', 'Drives'), icon: Route, to: '/drives' },
    { label: t('nav.charging', 'Charging'), icon: BatteryCharging, to: '/charging' },
    { label: t('nav.battery', 'Battery'), icon: Battery, to: '/battery' },
    { label: t('nav.climate', 'Climate'), icon: Thermometer, to: '/climate' },
    { label: t('nav.efficiency', 'Efficiency'), icon: BarChart3, to: '/efficiency' },
    { label: t('nav.settings', 'Settings'), icon: Settings, to: '/settings' },
  ]

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.quickLinks', 'Quick Links')}
      </PanelTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {quickLinks.map((link) => {
          const IconComp = link.icon
          return (
            <Link key={link.to} to={link.to}>
              <GlassPanel
                hover
                glow="cyan"
                className={cn(
                  'flex flex-col items-center gap-2 p-4 text-center',
                  'transition-all cursor-pointer',
                )}
              >
                <IconComp className="h-5 w-5 text-[var(--text-muted)]" aria-hidden="true" />
                <Text size="xs" weight="medium" color="primary" className="text-center">
                  {link.label}
                </Text>
              </GlassPanel>
            </Link>
          )
        })}
      </div>
    </GlassPanel>
  )
}
