import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Route, BatteryCharging, Battery, Thermometer, BarChart3, Settings, ChevronRight,
} from 'lucide-react'

import { GlassPanel, PanelTitle, Text } from '@/components/ui'
import { cn } from '@/lib/cn'

export function QuickLinksSection() {
  const { t } = useTranslation()

  // Memoised so the list (and the icon component refs it carries) keeps a
  // stable identity across re-renders, rebuilding only when the active
  // language — and therefore `t` — changes.
  const quickLinks = useMemo(
    () => [
      { label: t('nav.drives', 'Drives'), icon: Route, to: '/drives' },
      { label: t('nav.charging', 'Charging'), icon: BatteryCharging, to: '/charging' },
      { label: t('nav.battery', 'Battery'), icon: Battery, to: '/battery' },
      { label: t('nav.climate', 'Climate'), icon: Thermometer, to: '/climate' },
      { label: t('nav.efficiency', 'Efficiency'), icon: BarChart3, to: '/efficiency' },
      { label: t('nav.settings', 'Settings'), icon: Settings, to: '/settings' },
    ],
    [t],
  )

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <ChevronRight className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.quickLinks', 'Quick Links')}
      </PanelTitle>
      <nav
        aria-label={t('vehicles.detail.quickLinks', 'Quick Links')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {quickLinks.map((link) => {
          const IconComp = link.icon
          return (
            <Link
              key={link.to}
              to={link.to}
              className={cn(
                'block rounded-xl',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
              )}
            >
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
      </nav>
    </GlassPanel>
  )
}
