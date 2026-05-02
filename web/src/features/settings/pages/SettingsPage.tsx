import { useTranslation } from 'react-i18next'
import { useSettings } from '@/api/hooks/useSettings'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, IconBox } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry'
import { cn } from '@/lib/cn'
import { Zap, ExternalLink, Download, PlayCircle } from 'lucide-react'

import {
  TeslaAccountSection,
  FeatureToggles,
  RegionSettings,
  ActiveOrdersSection,
  GeneralSettings,
  GasPriceSettings,
  NotificationSettings,
  AppearanceSettings,
} from '../components'

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', 'Settings'))
  const { data: settings, isLoading } = useSettings()

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Configure TeslaSync preferences and Tesla account connection')}
      loading={isLoading}
    >
      <TeslaAccountSection />
      <FeatureToggles />
      <RegionSettings />
      <ActiveOrdersSection />

      {/* Fleet API Settings — link */}
      <FadeIn delay={0.05}>
        <a href="/fleet-api" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl ring-1',
              settings?.api_suspended
                ? 'bg-neon-red/10 text-neon-red ring-neon-red/20'
                : 'bg-neon-green/10 text-neon-green ring-neon-green/20'
            )}>
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('fleet.title', 'Fleet API Settings')}</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {settings?.api_suspended
                  ? t('fleet.suspended', 'API polling is suspended')
                  : t('fleet.description', 'Manage polling, endpoint toggles, and telemetry capture')}
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>

      <GeneralSettings />
      <GasPriceSettings />
      <NotificationSettings />
      <AppearanceSettings />

      {/* Data Export — link */}
      <FadeIn delay={0.18}>
        <a href="/data-export" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <IconBox color="green">
              <Download className="h-5 w-5" />
            </IconBox>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('export.title', 'Data Export')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('export.subtitle', 'Export drives, charging, analytics, or full backup as CSV/JSON')}</p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>

      {/* Onboarding Tour */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5 flex items-center gap-4" data-tour="settings-tour">
          <IconBox color="cyan">
            <PlayCircle className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('tour.title', 'Onboarding Tour')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('tour.description', 'Re-run the guided walkthrough of TeslaSync features')}</p>
          </div>
          <Button
            variant="ghost"
            onClick={() => dispatchTourLauncherOpen()}
          >
            <PlayCircle className="h-4 w-4 mr-2" />
            {t('tour.restart', 'Open Tour Launcher')}
          </Button>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  )
}
