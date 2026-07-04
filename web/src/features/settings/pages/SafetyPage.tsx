/**
 * SafetyPage — `/settings/safety`.
 *
 * Helix safety setting explainer host page, redesigned to the modern-ui
 * gold standard: a full-width cockpit view rather than a single stacked
 * column. The page reflows from one column on mobile into a multi-column
 * bento on wide monitors, so more screen width means more columns — never
 * dead side margins.
 *
 * Anatomy (top → bottom):
 *   1. Safety-posture KPI band — four metrics derived deterministically from
 *      `useSettings()` (active safeguards, quiet window, alert cadence, Fleet
 *      API state). No AI, no network beyond the settings query.
 *   2. Opt-in `<AISafetySettingExplainer>` narrator panel — renders ONLY when
 *      the user has enabled the `safety-setting-explainer` feature; in off mode
 *      the panel is absent from the DOM entirely (ADR-015 §I5 hidden UI). It
 *      NEVER changes settings.
 *   3. Deterministic listing of every safety-related setting as a responsive
 *      grid of `<SafetySettingCard>` tiles, each showing the setting's current
 *      value and a plain-English explanation with a docs deep-link. Rendered
 *      from `useSettings()` — no AI required, fully usable when `ai_mode='off'`.
 *
 * The "ShowsStaticHelpOnly" off-mode invariant test mounts THIS page, mocks
 * `useSettings()` with `ai_mode='off'`, and asserts (a) the safety listing
 * renders with each setting's current value visible via its
 * `safety-settings-value-<titleKey>` test ID, AND (b) the AI panel test ID is
 * absent. The positive control flips `ai_mode='cloud'` and the per-feature
 * toggle on, and asserts the AI panel test ID IS present. The row title
 * fallbacks and value test IDs are therefore a hard contract — keep them.
 */

import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ShieldCheck,
  Moon,
  BellRing,
  PlugZap,
  Sunset,
  Sunrise,
  Zap,
  Bell,
  Power,
  type LucideIcon,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Heading, Text, type BadgeProps } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { FadeIn } from '@/components/motion'
import { type NeonColor } from '@/lib/tokens'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSettings } from '@/hooks/useSettings'
import type { AppSettings } from '@/api/types'

import { AISafetySettingExplainer } from '@/components/ai/AISafetySettingExplainer'
import { SafetySettingCard } from '../components/SafetySettingCard'

// SafetySettingRow describes one row in the deterministic listing. The listing
// is hard-coded at module scope so the page renders the same set of safety
// toggles across users (the per-install live values come from `useSettings()`
// at render time). Keeping the metadata (title / description / docsAnchor)
// here matches the AI tool's projection in
// `internal/api/ai_safety_setting_explainer_handler.go` so human reviewers can
// cross-check the two surfaces in code review.
interface SafetySettingRow {
  /** i18n key for the row's title (English fallback supplied). Also the test-ID seed. */
  titleKey: string
  titleFallback: string
  /** i18n key for the row's plain-English description. */
  descKey: string
  descFallback: string
  /** Documentation link the user can click to read more. */
  docsAnchor: string
  /** Decorative leading icon for the tile. */
  icon: LucideIcon
  /** Toned icon accent — decorative grouping only, never the sole status signal. */
  accent: NeonColor
  /** Renders the current value as a string for the status chip. */
  renderValue: (s: AppSettings, t: TFunction) => string
  /** Status colour for the value chip (text always accompanies the colour). */
  badgeVariant: (s: AppSettings) => BadgeProps['variant']
}

// Safety-related settings ordered to mirror the
// `internal/api/ai_safety_setting_explainer_handler.go`
// `projectSafetySettingsEnvelope` projection. Reordering one surface without
// the other is OK (the human-readable order here is for the user; the AI tool
// returns a map keyed by setting ID), but the SET of settings MUST stay
// identical so the off-mode static-help surface lists everything Helix would
// explain on-mode.
const SAFETY_ROWS: SafetySettingRow[] = [
  {
    titleKey: 'safetySettings.rows.quietHoursEnabled.title',
    titleFallback: 'Quiet hours',
    descKey: 'safetySettings.rows.quietHoursEnabled.description',
    descFallback:
      'When ON, TeslaSync defers non-critical notifications during the configured quiet-hours window. Critical alerts are always delivered.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    icon: Moon,
    accent: 'blue',
    renderValue: (s, t) =>
      s.quiet_hours_enabled
        ? t('safetySettings.value.on', 'On')
        : t('safetySettings.value.off', 'Off'),
    badgeVariant: (s) => (s.quiet_hours_enabled ? 'success' : 'neutral'),
  },
  {
    titleKey: 'safetySettings.rows.quietHoursStart.title',
    titleFallback: 'Quiet-hours window start',
    descKey: 'safetySettings.rows.quietHoursStart.description',
    descFallback:
      'Window start in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    icon: Sunset,
    accent: 'blue',
    renderValue: (s) => coalesceBlank(s.quiet_hours_start, '—'),
    badgeVariant: () => 'info',
  },
  {
    titleKey: 'safetySettings.rows.quietHoursEnd.title',
    titleFallback: 'Quiet-hours window end',
    descKey: 'safetySettings.rows.quietHoursEnd.description',
    descFallback:
      'Window end in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    icon: Sunrise,
    accent: 'blue',
    renderValue: (s) => coalesceBlank(s.quiet_hours_end, '—'),
    badgeVariant: () => 'info',
  },
  {
    titleKey: 'safetySettings.rows.alertDigestMode.title',
    titleFallback: 'Alert digest mode',
    descKey: 'safetySettings.rows.alertDigestMode.description',
    descFallback:
      'How alerts are batched. Instant delivers each alert as it fires; Hourly batches into one digest per hour; Daily batches into one digest per day.',
    docsAnchor: '/docs/notifications/digest.md',
    icon: BellRing,
    accent: 'cyan',
    renderValue: (s) => coalesceBlank(s.alert_digest_mode, 'instant'),
    badgeVariant: () => 'info',
  },
  {
    titleKey: 'safetySettings.rows.criticalFlashEnabled.title',
    titleFallback: 'Critical-alert tab flash',
    descKey: 'safetySettings.rows.criticalFlashEnabled.description',
    descFallback:
      'When ON, TeslaSync briefly flashes the browser tab title when a critical alert arrives while the tab is in the background. Honours the OS-level reduce-motion preference.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    icon: Zap,
    accent: 'amber',
    renderValue: (s, t) =>
      s.critical_flash_enabled
        ? t('safetySettings.value.on', 'On')
        : t('safetySettings.value.off', 'Off'),
    badgeVariant: (s) => (s.critical_flash_enabled ? 'success' : 'neutral'),
  },
  {
    titleKey: 'safetySettings.rows.tabBadgeEnabled.title',
    titleFallback: 'Unread tab badge',
    descKey: 'safetySettings.rows.tabBadgeEnabled.description',
    descFallback:
      'When ON, TeslaSync prefixes the browser tab title with (N) and paints a coloured dot on the favicon for unread notifications.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    icon: Bell,
    accent: 'purple',
    renderValue: (s, t) =>
      s.tab_badge_enabled
        ? t('safetySettings.value.on', 'On')
        : t('safetySettings.value.off', 'Off'),
    badgeVariant: (s) => (s.tab_badge_enabled ? 'success' : 'neutral'),
  },
  {
    titleKey: 'safetySettings.rows.apiSuspended.title',
    titleFallback: 'API kill-switch',
    descKey: 'safetySettings.rows.apiSuspended.description',
    descFallback:
      'Operational kill-switch. When ON, TeslaSync stops issuing requests to the Tesla Fleet API; existing telemetry streams continue. Used during outage triage so the install does not pile up rate-limited retries.',
    docsAnchor: '/docs/operations/api-suspended.md',
    icon: Power,
    accent: 'green',
    renderValue: (s, t) =>
      s.api_suspended
        ? t('safetySettings.value.suspended', 'Suspended')
        : t('safetySettings.value.active', 'Active'),
    badgeVariant: (s) => (s.api_suspended ? 'warning' : 'success'),
  },
]

// Localized display labels for the alert-digest enum, used by the KPI summary
// chip. The listing row deliberately shows the raw canonical enum value
// (`instant`/`hourly`/`daily`) so the value mirrors what the backend stores;
// the KPI band is a polished summary, so it presents a translated label —
// mirroring how the Fleet-API enum is surfaced as Active/Suspended.
const DIGEST_LABELS: Record<string, { key: string; fallback: string }> = {
  instant: { key: 'safetySettings.digest.instant', fallback: 'Instant' },
  hourly: { key: 'safetySettings.digest.hourly', fallback: 'Hourly' },
  daily: { key: 'safetySettings.digest.daily', fallback: 'Daily' },
}

// Backend text columns that have never been written can come back as an empty
// string rather than null. Nullish coalescing (`??`) treats `''` as present,
// so a bare `value ?? fallback` would surface a blank status chip / KPI value.
// Collapse null/undefined/blank to the caller's fallback so a safety value is
// never rendered as an empty element.
function coalesceBlank(value: string | null | undefined, fallback: string): string {
  return value != null && value.trim().length > 0 ? value : fallback
}

export default function SafetyPage() {
  const { t } = useTranslation()
  usePageTitle(t('safetySettings.pageTitle', 'Safety settings'))
  const { settings } = useSettings()

  // Deterministic safety-posture summary derived from the same settings the
  // listing renders — no invented data, no extra network calls.
  const safeguards = [
    settings.quiet_hours_enabled,
    settings.critical_flash_enabled,
    settings.tab_badge_enabled,
  ]
  const safeguardsOn = safeguards.filter(Boolean).length
  const quietWindow = settings.quiet_hours_enabled
    ? `${coalesceBlank(settings.quiet_hours_start, '—')}–${coalesceBlank(settings.quiet_hours_end, '—')}`
    : t('safetySettings.kpi.quietWindowOff', 'Off')
  const digest = coalesceBlank(settings.alert_digest_mode, 'instant')
  const digestMeta = DIGEST_LABELS[digest]
  const digestLabel = digestMeta ? t(digestMeta.key, digestMeta.fallback) : digest
  const apiActive = !settings.api_suspended

  return (
    <PageContainer
      title={t('safetySettings.pageTitle', 'Safety settings')}
      subtitle={t(
        'safetySettings.pageSubtitle',
        'Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the API kill-switch. Use the links on each card to change a value.',
      )}
    >
      {/* 1 — Safety-posture KPI band: full-width responsive metric grid. */}
      <FadeIn>
        <section
          aria-label={t('safetySettings.kpi.sectionLabel', 'Safety posture')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('safetySettings.kpi.safeguards', 'Active safeguards')}
            value={`${safeguardsOn} / ${safeguards.length}`}
            icon={<ShieldCheck className="h-5 w-5" />}
            color={safeguardsOn === safeguards.length ? 'green' : 'cyan'}
            subtitle={t('safetySettings.kpi.safeguardsHint', 'Protections enabled')}
          />
          <MetricCard
            label={t('safetySettings.kpi.quietWindow', 'Quiet window')}
            value={quietWindow}
            icon={<Moon className="h-5 w-5" />}
            color="blue"
            subtitle={
              settings.quiet_hours_enabled
                ? t('safetySettings.kpi.quietWindowOn', 'Deferring non-critical')
                : t('safetySettings.kpi.quietWindowOffHint', 'Always delivering')
            }
          />
          <MetricCard
            label={t('safetySettings.kpi.cadence', 'Alert cadence')}
            value={digestLabel}
            icon={<BellRing className="h-5 w-5" />}
            color="cyan"
            subtitle={t('safetySettings.kpi.cadenceHint', 'Digest batching')}
          />
          <MetricCard
            label={t('safetySettings.kpi.fleetApi', 'Fleet API')}
            value={
              apiActive
                ? t('safetySettings.value.active', 'Active')
                : t('safetySettings.value.suspended', 'Suspended')
            }
            icon={<PlugZap className="h-5 w-5" />}
            color={apiActive ? 'green' : 'amber'}
            subtitle={t('safetySettings.kpi.fleetApiHint', 'Outbound requests')}
          />
        </section>
      </FadeIn>

      {/* 2 — Opt-in Helix narrator (absent from the DOM when AI is off). */}
      <FadeIn delay={0.1}>
        <section aria-label={t('safetySettings.aiExplainer.sectionLabel', 'Helix assistant')}>
          <AISafetySettingExplainer />
        </section>
      </FadeIn>

      {/* 3 — Deterministic listing: responsive bento of setting tiles. */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5" data-testid="safety-settings-listing">
          <div className="space-y-4">
            <header className="space-y-1">
              <Heading level="section">
                {t('safetySettings.listing.title', 'Your safety-related settings')}
              </Heading>
              <Text variant="bodySm" as="p">
                {t(
                  'safetySettings.listing.subtitle',
                  'Each tile shows the current value on this install and links to the canonical Settings page where you can change it.',
                )}
              </Text>
            </header>

            <ul
              className="grid gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fit,minmax(17rem,1fr))]"
              data-testid="safety-settings-rows"
            >
              {SAFETY_ROWS.map((row) => {
                const title = t(row.titleKey, row.titleFallback)
                return (
                  <SafetySettingCard
                    key={row.titleKey}
                    testKey={row.titleKey}
                    icon={<row.icon className="h-4 w-4" aria-hidden="true" />}
                    accent={row.accent}
                    title={title}
                    value={row.renderValue(settings, t)}
                    valueVariant={row.badgeVariant(settings)}
                    description={t(row.descKey, row.descFallback)}
                    docsHref={row.docsAnchor}
                    docsLabel={t('safetySettings.listing.docsLink', 'Docs')}
                    docsAriaLabel={t(
                      'safetySettings.listing.docsLinkAria',
                      'Open documentation for {{setting}}',
                      { setting: title },
                    )}
                  />
                )
              })}
            </ul>

            <Text variant="caption" as="p" className="pt-1">
              {t(
                'safetySettings.listing.changeHint',
                'To change a value, open the main Settings page. This page is read-only and never changes a setting on its own.',
              )}
            </Text>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  )
}
