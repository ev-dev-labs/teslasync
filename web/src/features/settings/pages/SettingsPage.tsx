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
import { ExternalLink, Download, PlayCircle, Rocket } from 'lucide-react'

import {
  GeneralSettings,
  AppearanceSettings,
  AdvancedSettings,
  SettingsSearch,
} from '../components'
// Phase-46 / Prompt 36 — Settings export/import has moved to the
// dedicated Backup & Restore page (/backup) so the DATA category owns
// every backup/restore surface. The component is still imported there
// from features/settings/components.
// Phase-46 / Prompt 42 — ActiveSessionsSection moved to its own page
// (ActiveSessionsPage). Direct import retained for the same reason.
//
// Phase-46 / Prompt 50 — Reset to defaults. Same direct-import
// rationale as above; the components barrel is outside the prompt's
// allowed-files regex.
import { ResetSection } from '../components/ResetSection'
// Phase-46 / Prompt 70 — PrivacySection moved to its own page
// (PrivacyPage at /account/privacy). Browser-local privacy controls
// (recently viewed pages, cookies / GDPR consent) now live under the
// Account side-nav category alongside 2FA and Active Sessions.
//
// Tesla integration redirect cluster (Tesla Account, Feature Flags,
// Region & API, Active Orders, Gas Price Auto-Poll) and the Fleet API
// link card were removed: every target is reachable from the
// Integrations side-nav group, so the in-page placeholders were just
// duplicate redirects.

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', 'Settings'))
  const { isLoading } = useSettings()
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

      {/* Tesla integration redirect cluster + Fleet API link card were
          removed in favor of the Integrations side-nav group. Every
          target page (/tesla-account, /tesla-features, /tesla-region,
          /tesla-orders, /gas-price, /fleet-api) is reachable from the
          sidebar, and Cmd-K palette entries in searchIndex.ts already
          point directly at those pages, so the in-page placeholders
          were duplicate redirects with no remaining purpose. */}

      <section id="general">
        <GeneralSettings />
      </section>
      <section id="appearance">
        <AppearanceSettings />
      </section>
      <section id="advanced">
        <AdvancedSettings />
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
