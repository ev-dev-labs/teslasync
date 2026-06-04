/**
 * SafetyPage — `/settings/safety`.
 *
 * Helix safety setting explainer host page.
 *
 * Renders the deterministic, AI-OFF-safe listing of every
 * safety-related TeslaSync setting (notification quiet hours,
 * alert digest mode, critical-flash signalling, tab-badge
 * signalling, and the API-suspended operational gate) with
 * each setting's current value and a short plain-English
 * explanation. The listing is rendered from `useSettings()` —
 * no AI is required to view it, and the page works fully when
 * `ai_mode='off'`.
 *
 * Above the listing, the opt-in `<AISafetySettingExplainer>`
 * panel renders ONLY when the user has enabled the
 * `safety-setting-explainer` feature; in off mode the panel is
 * absent from the DOM entirely (ADR-015 §I5 hidden UI). The AI
 * panel NEVER changes settings — to update a value the user
 * follows the canonical "Open Settings" link below each row.
 *
 * The "ShowsStaticHelpOnly" off-mode invariant test mounts THIS
 * page, mocks `useSettings()` with `ai_mode='off'`, and asserts
 * (a) the safety listing renders with each setting's current
 * value visible, AND (b) the AI panel test ID is absent. The
 * positive control flips `ai_mode='cloud'` and the per-feature
 * toggle on, and asserts the AI panel test ID IS present.
 */

import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { Badge } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSettings } from '@/hooks/useSettings';

import { AISafetySettingExplainer } from '@/components/ai/AISafetySettingExplainer';

// SafetySettingRow describes one row in the deterministic
// listing. The listing is hard-coded at module scope so the
// page renders the same set of safety toggles across users
// (the per-install live values come from `useSettings()` at
// render time). Keeping the metadata (title / description /
// docsAnchor) here matches the AI tool's projection in
// `internal/api/ai_safety_setting_explainer_handler.go` so
// human reviewers can cross-check the two surfaces in code
// review.
interface SafetySettingRow {
  /** i18n key for the row's title (English fallback supplied). */
  titleKey: string;
  titleFallback: string;
  /** i18n key for the row's plain-English description. */
  descKey: string;
  descFallback: string;
  /** Documentation link the user can click to read more. */
  docsAnchor: string;
  /** Renders the current value as a string for the badge. */
  renderValue: (s: ReturnType<typeof useSettings>['settings']) => string;
}

// Safety-related settings ordered to mirror the
// `internal/api/ai_safety_setting_explainer_handler.go`
// `projectSafetySettingsEnvelope` projection. Reordering one
// surface without the other is OK (the human-readable order
// here is for the user; the AI tool returns a map keyed by
// setting ID), but the SET of settings MUST stay identical so
// the off-mode static-help surface lists everything Helix
// would explain on-mode.
const SAFETY_ROWS: SafetySettingRow[] = [
  {
    titleKey: 'safetySettings.rows.quietHoursEnabled.title',
    titleFallback: 'Quiet hours',
    descKey: 'safetySettings.rows.quietHoursEnabled.description',
    descFallback:
      'When ON, TeslaSync defers non-critical notifications during the configured quiet-hours window. Critical alerts are always delivered.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: (s) => (s.quiet_hours_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.quietHoursStart.title',
    titleFallback: 'Quiet-hours window start',
    descKey: 'safetySettings.rows.quietHoursStart.description',
    descFallback:
      'Window start in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: (s) => s.quiet_hours_start ?? '—',
  },
  {
    titleKey: 'safetySettings.rows.quietHoursEnd.title',
    titleFallback: 'Quiet-hours window end',
    descKey: 'safetySettings.rows.quietHoursEnd.description',
    descFallback:
      'Window end in HH:MM (24-hour) local time. Effective only when quiet hours are ON.',
    docsAnchor: '/docs/notifications/quiet-hours.md',
    renderValue: (s) => s.quiet_hours_end ?? '—',
  },
  {
    titleKey: 'safetySettings.rows.alertDigestMode.title',
    titleFallback: 'Alert digest mode',
    descKey: 'safetySettings.rows.alertDigestMode.description',
    descFallback:
      'How alerts are batched. Instant delivers each alert as it fires; Hourly batches into one digest per hour; Daily batches into one digest per day.',
    docsAnchor: '/docs/notifications/digest.md',
    renderValue: (s) => s.alert_digest_mode ?? 'instant',
  },
  {
    titleKey: 'safetySettings.rows.criticalFlashEnabled.title',
    titleFallback: 'Critical-alert tab flash',
    descKey: 'safetySettings.rows.criticalFlashEnabled.description',
    descFallback:
      'When ON, TeslaSync briefly flashes the browser tab title when a critical alert arrives while the tab is in the background. Honours the OS-level reduce-motion preference.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    renderValue: (s) => (s.critical_flash_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.tabBadgeEnabled.title',
    titleFallback: 'Unread tab badge',
    descKey: 'safetySettings.rows.tabBadgeEnabled.description',
    descFallback:
      'When ON, TeslaSync prefixes the browser tab title with (N) and paints a coloured dot on the favicon for unread notifications.',
    docsAnchor: '/docs/notifications/tab-signalling.md',
    renderValue: (s) => (s.tab_badge_enabled ? 'On' : 'Off'),
  },
  {
    titleKey: 'safetySettings.rows.apiSuspended.title',
    titleFallback: 'API kill-switch',
    descKey: 'safetySettings.rows.apiSuspended.description',
    descFallback:
      'Operational kill-switch. When ON, TeslaSync stops issuing requests to the Tesla Fleet API; existing telemetry streams continue. Used during outage triage so the install does not pile up rate-limited retries.',
    docsAnchor: '/docs/operations/api-suspended.md',
    renderValue: (s) => (s.api_suspended ? 'Suspended' : 'Active'),
  },
];

export default function SafetyPage() {
  const { t } = useTranslation();
  usePageTitle(t('safetySettings.pageTitle', 'Safety settings'));
  const { settings } = useSettings();

  return (
    <PageContainer
      title={t('safetySettings.pageTitle', 'Safety settings')}
      subtitle={t(
        'safetySettings.pageSubtitle',
        'Notification quiet hours, alert digest mode, critical-flash signalling, tab-badge signalling, and the API kill-switch. Use the links below each row to change a value.',
      )}
    >
      <FadeIn>
        <AISafetySettingExplainer />
      </FadeIn>

      <FadeIn>
        <GlassPanel data-testid="safety-settings-listing">
          <div className="space-y-4">
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                {t(
                  'safetySettings.listing.title',
                  'Your safety-related settings',
                )}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                {t(
                  'safetySettings.listing.subtitle',
                  'Each row shows the current value on this install and links to the canonical Settings page where you can change it.',
                )}
              </p>
            </header>

            <ul
              className="divide-y divide-white/5"
              data-testid="safety-settings-rows"
            >
              {SAFETY_ROWS.map((row) => {
                const value = row.renderValue(settings);
                return (
                  <li
                    key={row.titleKey}
                    className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-start"
                    data-testid={`safety-settings-row-${row.titleKey}`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {t(row.titleKey, row.titleFallback)}
                        </span>
                        <Badge
                          variant="info"
                          size="sm"
                          data-testid={`safety-settings-value-${row.titleKey}`}
                        >
                          {value}
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)]">
                        {t(row.descKey, row.descFallback)}
                      </p>
                    </div>
                    <div className="text-xs sm:pt-1">
                      <a
                        href={row.docsAnchor}
                        className="text-cyan-300 hover:text-cyan-200"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('safetySettings.listing.docsLink', 'Docs')}
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="pt-2 text-xs text-[var(--text-muted)]">
              {t(
                'safetySettings.listing.changeHint',
                'To change a value, open the main Settings page. This page is read-only and never changes a setting on its own.',
              )}
            </p>
          </div>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
