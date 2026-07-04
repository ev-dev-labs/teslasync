import { useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Download,
  PlayCircle,
  Rocket,
  Ruler,
  Thermometer,
  Gauge,
  Languages,
  CircleDollarSign,
  Zap,
  Type,
} from 'lucide-react'

import { useSettings } from '@/api/hooks/useSettings'
import { useFont } from '@/components/ui/FontProvider'
import { PageContainer, Masonry } from '@/components/layout'
import { Button, SectionTitle } from '@/components/ui'
import { StatCard } from '@/components/data-display'
import { FadeIn } from '@/components/motion'
import { EditConflictBanner } from '@/components/feedback'
import { useToast } from '@/components/feedback/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useEditLease } from '@/hooks/useEditLease'
import { dispatchTourLauncherOpen } from '@/lib/tourRegistry'
import { restartChecklist } from '@/features/onboarding/checklist'

import {
  GeneralSettings,
  AppearanceSettings,
  TypographySettings,
  AdvancedSettings,
  SettingsSearch,
  SettingsActionCard,
} from '../components'
// ResetSection is imported directly because the components barrel is
// outside the redesign prompt's allowed-files regex.
import { ResetSection } from '../components/ResetSection'

// The Tesla integration redirect cluster (Tesla Account, Feature Flags,
// Region & API, Active Orders, Gas Price Auto-Poll), the Fleet API link
// card, Privacy, Active Sessions, and Helix (AI) were all promoted out of
// /settings into dedicated Integrations/Account pages — every target is
// reachable from the side-nav + Cmd-K palette, so the in-page placeholders
// were duplicate redirects. The legacy /settings#ai deep link still
// redirects to /integrations/helix via the effect below.

/** Short human labels for the stored `language` code shown in the KPI band. */
const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  zh: '中文',
}

/** Display names for the stored font-family preset shown in the KPI band. */
const FONT_FAMILY_LABELS: Record<string, string> = {
  inter: 'Inter',
  system: 'System UI',
  roboto: 'Roboto',
  source: 'Source Sans 3',
  plex: 'IBM Plex Sans',
  atkinson: 'Atkinson Hyperlegible',
  custom: 'Custom',
}

interface OverviewCard {
  icon: ReactNode
  label: string
  value: string
  sublabel?: string
}

/**
 * Coalesce a unit string to an em-dash when it is null, undefined, or blank.
 * The KPI band must never render an empty value cell — an absent/blank unit
 * shows "—" exactly like the loading / no-settings placeholder instead of a
 * visually empty StatCard.
 */
function orDash(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : '—'
}

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', 'Settings'))
  const settingsQuery = useSettings()
  const { data: settings, isLoading } = settingsQuery
  const { prefs: fontPrefs } = useFont()
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()

  // Claim an edit lease for the whole settings page so a second tab editing
  // the same settings sees a banner before its save can silently overwrite
  // this tab's changes. Scoped per-origin (settings are single-tenant today).
  const settingsLeaseKey = 'settings/general'
  useEditLease(settingsLeaseKey)

  // Legacy /settings#ai → /integrations/helix redirect. Fires before the
  // hash-anchor scroll effect below so #ai never resolves to a missing
  // section. Replaces history so the back button skips the stale entry.
  useEffect(() => {
    if (location.hash === '#ai') {
      navigate('/integrations/helix', { replace: true })
    }
  }, [location.hash, navigate])

  // Hash-anchor scroll: when /settings#appearance (or any other anchor)
  // loads, scroll the corresponding <section id="..."> into view. Triggered
  // by the onboarding-checklist CTAs and the settings search box.
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

  // ── Derived "preferences at a glance" cards (null-safe, display only) ──
  // Memoised so the seven KPI cards + their icon nodes are only rebuilt when
  // the underlying settings, font prefs, or translator actually change — not on
  // every unrelated re-render (edit-lease election ticks, hash-effect cleanups).
  const overviewCards = useMemo<OverviewCard[]>(() => {
    const languageCode = settings?.language ? settings.language.toUpperCase() : '—'
    const languageName = settings?.language ? LANGUAGE_LABELS[settings.language] : undefined
    const currencySymbol = settings?.currency_symbol ?? '$'
    const rangeLabel = settings
      ? settings.preferred_range === 'ideal'
        ? t('app.ideal', 'Ideal')
        : t('app.rated', 'Rated')
      : undefined

    return [
      {
        icon: <Ruler className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.distance', 'Distance'),
        value: orDash(settings?.unit_of_length),
        sublabel: rangeLabel,
      },
      {
        icon: <Thermometer className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.temperature', 'Temperature'),
        value: settings ? (settings.unit_of_temp === 'F' ? '°F' : '°C') : '—',
      },
      {
        icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.pressure', 'Pressure'),
        value: orDash(settings?.unit_of_pressure),
      },
      {
        icon: <Languages className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.language', 'Language'),
        value: languageCode,
        sublabel: languageName,
      },
      {
        icon: <CircleDollarSign className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.currency', 'Currency'),
        value: settings ? currencySymbol : '—',
      },
      {
        icon: <Zap className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.energyCost', 'Energy cost'),
        value: settings ? `${currencySymbol}${(settings.base_cost_per_kwh ?? 0).toFixed(2)}` : '—',
        sublabel: t('overview.perKwh', 'per kWh'),
      },
      {
        icon: <Type className="h-5 w-5" aria-hidden="true" />,
        label: t('overview.typography', 'Typography'),
        value: FONT_FAMILY_LABELS[fontPrefs.sans] ?? fontPrefs.sans,
        sublabel: `${Math.round((fontPrefs.scale ?? 1) * 100)}%`,
      },
    ]
  }, [settings, fontPrefs, t])

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Configure TeslaSync preferences and Tesla account connection')}
      actions={<SettingsSearch className="w-full sm:w-72" />}
      query={settingsQuery}
    >
      <EditConflictBanner
        resourceKey={settingsLeaseKey}
        resourceLabel={t('editConflict.resource.settings', 'Your settings')}
      />

      {/* 1 — Preferences at a glance: full-width KPI band that reflows to
          6 columns on wide screens. */}
      <FadeIn>
        <section
          aria-label={t('overview.aria', 'Current preferences overview')}
          className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          {overviewCards.map((card) => (
            <StatCard
              key={card.label}
              label={card.label}
              value={card.value}
              sublabel={card.sublabel}
              icon={card.icon}
              loading={isLoading}
            />
          ))}
        </section>
      </FadeIn>

      {/* 2 — Preference sections: full-width bento; each self-titled panel
          owns its own loading/empty state and keeps its #anchor for the
          settings search + onboarding deep links. Two columns on 2xl+. */}
      <Masonry
        as="section"
        aria-label={t('preferences.aria', 'Preference sections')}
        className="columns-1 2xl:columns-2"
      >
        <section id="general">
          <GeneralSettings />
        </section>
        <AppearanceSettings />
        <section id="typography">
          <TypographySettings />
        </section>
        <section id="advanced">
          <AdvancedSettings />
        </section>
        <section id="reset">
          <ResetSection />
        </section>
      </Masonry>

      {/* 3 — Quick actions: equal-height utility cards that fill the width
          (1 → 2 → 3 columns). */}
      <FadeIn delay={0.1}>
        <section aria-label={t('quickActions.aria', 'Settings shortcuts')} className="space-y-3">
          <SectionTitle>{t('quickActions.title', 'Quick actions')}</SectionTitle>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SettingsActionCard
              href="/data-export"
              iconColor="green"
              icon={<Download className="h-5 w-5" aria-hidden="true" />}
              title={t('export.title', 'Data Export')}
              description={t(
                'export.subtitle',
                'Export drives, charging, analytics, or full backup as CSV/JSON',
              )}
            />
            <SettingsActionCard
              dataTour="settings-tour"
              iconColor="cyan"
              icon={<PlayCircle className="h-5 w-5" aria-hidden="true" />}
              title={t('tour.title', 'Onboarding Tour')}
              description={t('tour.description', 'Re-run the guided walkthrough of TeslaSync features')}
              action={
                <Button variant="ghost" onClick={() => dispatchTourLauncherOpen()}>
                  <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('tour.restart', 'Open Tour Launcher')}
                </Button>
              }
            />
            <SettingsActionCard
              iconColor="cyan"
              icon={<Rocket className="h-5 w-5" aria-hidden="true" />}
              title={t('checklist.settings.title', 'Setup Checklist')}
              description={t(
                'checklist.settings.description',
                'Restart the first-run checklist widget on your dashboard. If you removed it, re-add the “Setup Checklist” widget from the dashboard customizer.',
              )}
              action={
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
                  <Rocket className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('checklist.settings.restart', 'Restart Checklist')}
                </Button>
              }
            />
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  )
}
