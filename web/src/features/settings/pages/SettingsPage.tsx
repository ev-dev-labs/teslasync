import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@/api/hooks/useSettings'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, IconBox } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry'
import { restartChecklist } from '@/features/onboarding/checklist'
import { useToast } from '@/components/feedback/Toast'
import { EditConflictBanner } from '@/components/feedback'
import { useEditLease } from '@/hooks/useEditLease'
import { cn } from '@/lib/cn'
import { Zap, ExternalLink, Download, PlayCircle, Rocket } from 'lucide-react'

import {
  TeslaAccountSection,
  FeatureToggles,
  RegionSettings,
  ActiveOrdersSection,
  GeneralSettings,
  GasPriceSettings,
  NotificationSettings,
  QuietHoursPanel,
  AppearanceSettings,
  AdvancedSettings,
  SettingsSearch,
} from '../components'
// Phase-46 / Prompt 35 — TOTPEnrollmentSection is intentionally
// imported directly, NOT through the `../components` barrel, so the
// barrel index.ts can stay outside the prompt's allowed-files regex.
import { TOTPEnrollmentSection } from '../components/TOTPEnrollmentSection'
// Phase-46 / Prompt 36 — Settings export/import. Same direct-import
// rationale as TOTPEnrollmentSection above; the components barrel
// is not in the prompt's allowed-files regex.
import { SettingsExportImport } from '../components/SettingsExportImport'
// Phase-46 / Prompt 37 — Webhook channels. Direct import for the
// same reason: the `../components` barrel is outside this prompt's
// allowed-files regex.
import { WebhookChannelsSection } from '../components/WebhookChannelsSection'
// Phase-46 / Prompt 42 — Active sessions / device management. Same
// direct-import rationale: barrel is outside the prompt's
// allowed-files regex.
import { ActiveSessionsSection } from '../components/ActiveSessionsSection'
// Phase-46 / Prompt 50 — Reset to defaults. Same direct-import
// rationale as above; the components barrel is outside the prompt's
// allowed-files regex.
import { ResetSection } from '../components/ResetSection'
// Phase-46 / Prompt 70 — Privacy section (now expanded with cookie /
// GDPR consent management). Direct import for the same barrel-scope
// rationale.
import { PrivacySection } from '../components/PrivacySection'

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', 'Settings'))
  const { data: settings, isLoading } = useSettings()
  const toast = useToast()
  const location = useLocation()

  // Phase-46 / Prompt 66 — claim an edit lease for the entire settings
  // page so a second tab editing the same settings sees a banner before
  // their save can silently overwrite this tab's changes. The lease is
  // scoped per-origin (no per-user scoping yet because TeslaSync's
  // settings are single-tenant); future work can append a user subject
  // when multi-tenant settings land.
  const settingsLeaseKey = 'settings/general'
  useEditLease(settingsLeaseKey)

  // Hash-anchor scroll: when /settings#appearance (or any other anchor)
  // loads, scroll the corresponding <section id="..."> into view. Triggered
  // by the onboarding-checklist CTAs (Phase-40 / Prompt 68).
  useEffect(() => {
    if (!location.hash) return
    const id = location.hash.slice(1)
    if (!id) return
    // Small delay so lazy-loaded sections + i18n have a chance to mount.
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [location.hash])

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Configure TeslaSync preferences and Tesla account connection')}
      loading={isLoading}
    >
      <SettingsSearch className="mb-2" />

      <EditConflictBanner
        resourceKey={settingsLeaseKey}
        resourceLabel={t('editConflict.resource.settings', 'Your settings')}
      />

      <section id="tesla-account">
        <TeslaAccountSection />
      </section>
      <section id="features">
        <FeatureToggles />
      </section>
      <section id="region">
        <RegionSettings />
      </section>
      <section id="orders">
        <ActiveOrdersSection />
      </section>

      {/* Fleet API Settings — link */}
      <FadeIn delay={0.05}>
        <a href="/fleet-api" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-[var(--border-subtle)] transition-colors cursor-pointer group">
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

      <section id="general">
        <GeneralSettings />
      </section>
      <section id="gas-price">
        <GasPriceSettings />
      </section>
      <section id="notifications">
        <NotificationSettings />
      </section>
      <section id="webhooks">
        <WebhookChannelsSection />
      </section>
      <section id="quiet-hours">
        <QuietHoursPanel />
      </section>
      <section id="appearance">
        <AppearanceSettings />
      </section>
      <section id="security">
        <TOTPEnrollmentSection />
      </section>
      <section id="sessions">
        <ActiveSessionsSection />
      </section>
      <section id="advanced">
        <AdvancedSettings />
      </section>
      <section id="privacy">
        <PrivacySection />
      </section>
      <section id="backup">
        <SettingsExportImport />
      </section>
      <section id="reset">
        <ResetSection />
      </section>

      {/* Data Export — link */}
      <FadeIn delay={0.18}>
        <a href="/data-export" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-[var(--border-subtle)] transition-colors cursor-pointer group">
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

      {/* Setup Checklist — restart affordance (Phase-40 / Prompt 68) */}
      <FadeIn delay={0.22}>
        <GlassPanel className="p-5 flex items-center gap-4">
          <IconBox color="cyan">
            <Rocket className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              {t('checklist.settings.title', 'Setup Checklist')}
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              {t(
                'checklist.settings.description',
                'Restart the first-run checklist widget on your dashboard. If you removed it, re-add the “Setup Checklist” widget from the dashboard customizer.',
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              restartChecklist()
              toast.success(
                t(
                  'checklist.settings.restarted',
                  'Setup checklist restarted — re-add the widget from the dashboard customizer if needed.',
                ),
              )
            }}
          >
            <Rocket className="h-4 w-4 mr-2" />
            {t('checklist.settings.restart', 'Restart Checklist')}
          </Button>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  )
}
