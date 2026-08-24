// Settings find-as-you-type index.
//
// Each entry maps a single user-discoverable setting to its target URL,
// which is usually a hash anchor on `/settings` itself (`#general`,
// `#appearance`, etc.) but can also be a full path on another page when
// a setting has been promoted out of `/settings` (e.g. Helix lives at
// `/integrations/helix` but should still surface when the user types
// "ai" here). The `<SettingsSearch>` component uses substring + fuzzy-
// subsequence matching against `title`, `description`, and `keywords`
// to surface the right entry as the user types.
//
// Adding a new entry
// ------------------
// 1. For an in-page entry: add the section's `id="..."` anchor to
//    `SettingsPage.tsx` if it doesn't already exist.
// 2. Append an entry below with a stable `id` slug, the `href`, and
//    human-meaningful `title`/`description`/`keywords` so users typing
//    common synonyms (e.g. "psi" for tire pressure unit) still find
//    the right setting.

import type { TFunction } from 'i18next';

export interface SettingsEntry {
  /** Stable slug. Used as the React key and for analytics if added later. */
  id: string;
  /**
   * Target URL. Usually a hash anchor on `/settings` itself
   * (e.g. `/settings#appearance`) but may be a full path on another
   * page when a setting has been promoted out of `/settings`
   * (e.g. `/integrations/helix`).
   */
  href: string;
  /** Translated title shown in the dropdown. */
  title: string;
  /** Translated long description for fuzzy match and the second line of the dropdown row. */
  description: string;
  /** Section id this entry belongs to (for grouping / future section labels). */
  section: string;
  /** Optional synonyms / abbreviations that should match this entry but don't fit naturally in the title or description. */
  keywords?: readonly string[];
}

/**
 * Build the canonical list of indexed settings. Pass the `t` function
 * from `useTranslation('settings')` so titles and descriptions stay in
 * sync with the rest of the page (and so future namespaces can be
 * swapped in without touching every entry).
 */
export function getSettingsIndex(t: TFunction): SettingsEntry[] {
  return [
    // ── Tesla account ───────────────────────────────────────────────
    {
      id: 'tesla.connect',
      href: '/tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.connect.title', 'Connect Tesla account'),
      description: t('search.entries.tesla.connect.desc', 'Authorize TeslaSync to access your Tesla account.'),
      keywords: ['oauth', 'login', 'authorize', 'sign in'],
    },
    {
      id: 'tesla.refresh-token',
      href: '/tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.refreshToken.title', 'Tesla refresh token'),
      description: t('search.entries.tesla.refreshToken.desc', 'Manually refresh the cached Tesla OAuth token.'),
      keywords: ['oauth', 'token', 'auth'],
    },
    {
      id: 'tesla.disconnect',
      href: '/tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.disconnect.title', 'Disconnect Tesla account'),
      description: t('search.entries.tesla.disconnect.desc', 'Sign out and remove the cached OAuth token.'),
      keywords: ['logout', 'sign out', 'remove'],
    },
    {
      id: 'tesla.sync-vehicles',
      href: '/tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.syncVehicles.title', 'Sync vehicles from Tesla'),
      description: t('search.entries.tesla.syncVehicles.desc', 'Pull the current vehicle list from the Tesla Fleet API.'),
      keywords: ['vin', 'cars', 'fleet'],
    },

    // ── Region & API ────────────────────────────────────────────────
    {
      id: 'region.fleet-api',
      href: '/tesla-region',
      section: 'region',
      title: t('search.entries.region.title', 'Region & Fleet API endpoint'),
      description: t('search.entries.region.desc', 'Tesla account region and the resolved Fleet API base URL.'),
      keywords: ['country', 'tld', 'endpoint', 'na', 'eu'],
    },

    // ── Feature flags ───────────────────────────────────────────────
    {
      id: 'features.flags',
      href: '/tesla-features',
      section: 'features',
      title: t('search.entries.features.title', 'Feature flags'),
      description: t('search.entries.features.desc', 'Tesla account feature configuration synced from the Fleet API.'),
      keywords: ['premium', 'subscription', 'config'],
    },

    // ── Active orders ───────────────────────────────────────────────
    {
      id: 'orders.active',
      href: '/tesla-orders',
      section: 'orders',
      title: t('search.entries.orders.title', 'Active orders'),
      description: t('search.entries.orders.desc', 'Vehicle orders and delivery tracking from Tesla.'),
      keywords: ['delivery', 'order', 'reservation'],
    },

    // ── General — units & cost ──────────────────────────────────────
    {
      id: 'general.units.distance',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.distance.title', 'Distance unit'),
      description: t('search.entries.general.distance.desc', 'Show distances in kilometers or miles.'),
      keywords: ['km', 'mi', 'metric', 'imperial'],
    },
    {
      id: 'general.units.temperature',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.temperature.title', 'Temperature unit'),
      description: t('search.entries.general.temperature.desc', 'Show temperatures in Celsius or Fahrenheit.'),
      keywords: ['celsius', 'fahrenheit', 'c', 'f'],
    },
    {
      id: 'general.units.pressure',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.pressure.title', 'Tire pressure unit'),
      description: t('search.entries.general.pressure.desc', 'Show tire pressure in Bar or PSI.'),
      keywords: ['psi', 'bar', 'tire', 'tyre'],
    },
    {
      id: 'general.range',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.range.title', 'Preferred range'),
      description: t('search.entries.general.range.desc', 'Display rated or ideal range for the battery.'),
      keywords: ['ideal', 'rated', 'epa'],
    },
    {
      id: 'general.precision',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.precision.title', 'Decimal precision'),
      description: t('search.entries.general.precision.desc', 'Number of decimal places shown on numeric metrics.'),
      keywords: ['decimals', 'rounding', 'sig figs'],
    },
    {
      id: 'general.language',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.language.title', 'Language'),
      description: t('search.entries.general.language.desc', 'Application interface language.'),
      keywords: ['locale', 'translation', 'i18n'],
    },
    {
      id: 'general.currency',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.currency.title', 'Currency'),
      description: t('search.entries.general.currency.desc', 'Currency symbol used in cost and savings displays.'),
      keywords: ['usd', 'eur', 'gbp', 'money'],
    },
    {
      id: 'general.locale',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.locale.title', 'Number & date locale'),
      description: t('search.entries.general.locale.desc', 'Locale used for number, date, and time formatting.'),
      keywords: ['format', 'thousand separator', 'comma'],
    },
    {
      id: 'general.timezone',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.timezone.title', 'Time zone'),
      description: t('search.entries.general.timezone.desc', 'Whether timestamps follow the vehicle, your local time, or UTC.'),
      keywords: ['tz', 'utc', 'local', 'iana'],
    },
    {
      id: 'general.electricity-cost',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.electricityCost.title', 'Electricity cost (per kWh)'),
      description: t('search.entries.general.electricityCost.desc', 'Per-kWh price used in charging cost calculations.'),
      keywords: ['kwh', 'price', 'rate', 'cost'],
    },
    {
      id: 'general.gas-price',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.gasPriceManual.title', 'Comparison gas price'),
      description: t('search.entries.general.gasPriceManual.desc', 'Manual gas price used in EV-vs-ICE savings comparisons.'),
      keywords: ['fuel', 'gallon', 'liter', 'gasoline'],
    },
    {
      id: 'general.mpg',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.mpg.title', 'Comparison vehicle MPG'),
      description: t('search.entries.general.mpg.desc', 'Average MPG of the equivalent gas car for savings calculations.'),
      keywords: ['fuel economy', 'efficiency', 'mpg'],
    },

    // ── Gas price auto-poll ─────────────────────────────────────────
    {
      id: 'gas-price.auto-poll',
      href: '/gas-price',
      section: 'gas-price',
      title: t('search.entries.gasPrice.title', 'Gas price auto-poll'),
      description: t('search.entries.gasPrice.desc', 'Automatically fetch US average gas prices from EIA.'),
      keywords: ['eia', 'fuel', 'poll', 'auto'],
    },

    // ── Notifications ───────────────────────────────────────────────
    {
      id: 'notifications.browser-permission',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.browser.title', 'Browser notifications'),
      description: t('search.entries.notifications.browser.desc', 'Enable browser notifications when the tab is in the background.'),
      keywords: ['push', 'permission', 'desktop'],
    },
    {
      id: 'notifications.alerts',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.alerts.title', 'Alert notifications'),
      description: t('search.entries.notifications.alerts.desc', 'Get notified when an alert rule fires.'),
      keywords: ['rules', 'alarm', 'warning'],
    },
    {
      id: 'notifications.export-status',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.exportStatus.title', 'Export completion notifications'),
      description: t('search.entries.notifications.exportStatus.desc', 'Get notified when a CSV/JSON export finishes.'),
      keywords: ['export', 'download', 'csv', 'json'],
    },
    {
      id: 'notifications.tab-badge',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.tabBadge.title', 'Browser tab unread badge'),
      description: t('search.entries.notifications.tabBadge.desc', 'Show unread count in the browser tab title and favicon.'),
      keywords: ['favicon', 'count', 'tab'],
    },
    {
      id: 'notifications.critical-flash',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.criticalFlash.title', 'Critical alert tab flash'),
      description: t('search.entries.notifications.criticalFlash.desc', 'Flash the browser tab title on critical alerts.'),
      keywords: ['flash', 'urgent', 'tab'],
    },
    {
      id: 'notifications.sound-master',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.soundMaster.title', 'Notification sounds'),
      description: t('search.entries.notifications.soundMaster.desc', 'Play short audio cues when alerts and completion events arrive.'),
      keywords: ['audio', 'sound', 'chime', 'beep', 'noise', 'mute', 'volume'],
    },
    {
      id: 'notifications.sound-channels',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.soundChannels.title', 'Per-channel notification sounds'),
      description: t('search.entries.notifications.soundChannels.desc', 'Toggle sound separately for critical, warning, and info alerts plus charge/drive/automation completions.'),
      keywords: ['critical', 'warning', 'info', 'channel', 'category', 'audio', 'cue'],
    },
    {
      id: 'notifications.sound-volume',
      href: '/notifications/browser',
      section: 'notifications',
      title: t('search.entries.notifications.soundVolume.title', 'Notification sound volume'),
      description: t('search.entries.notifications.soundVolume.desc', 'Adjust how loud notification cues play.'),
      keywords: ['volume', 'loud', 'quiet', 'audio', 'level'],
    },

    // ── Quiet hours / Do-Not-Disturb ────────────────────────────────
    {
      id: 'quiet-hours.windows',
      href: '/notifications/quiet-hours',
      section: 'quiet-hours',
      title: t('search.entries.quietHours.windows.title', 'Quiet hours windows'),
      description: t('search.entries.quietHours.windows.desc', 'Defer non-critical notifications during sleep, work meetings, or any time-of-day window.'),
      keywords: ['dnd', 'do not disturb', 'sleep', 'mute', 'silence', 'night'],
    },
    {
      id: 'quiet-hours.bypass-severities',
      href: '/notifications/quiet-hours',
      section: 'quiet-hours',
      title: t('search.entries.quietHours.bypass.title', 'Quiet hours bypass severities'),
      description: t('search.entries.quietHours.bypass.desc', 'Choose which severities (e.g. critical) still ring through during quiet hours.'),
      keywords: ['critical', 'override', 'bypass', 'severity'],
    },
    {
      id: 'quiet-hours.timezone',
      href: '/notifications/quiet-hours',
      section: 'quiet-hours',
      title: t('search.entries.quietHours.timezone.title', 'Quiet hours timezone'),
      description: t('search.entries.quietHours.timezone.desc', 'Pick the IANA timezone the start/end times are evaluated against.'),
      keywords: ['tz', 'timezone', 'iana', 'utc'],
    },

    // ── Appearance ──────────────────────────────────────────────────
    {
      id: 'appearance.theme',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.theme.title', 'Theme'),
      description: t('search.entries.appearance.theme.desc', 'Choose light, dark, or system mode and pick an accent color.'),
      keywords: ['dark', 'light', 'color', 'accent', 'mode'],
    },
    {
      id: 'appearance.density',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.density.title', 'Information density'),
      description: t('search.entries.appearance.density.desc', 'Compact, comfortable, or spacious row sizing across tables and cards.'),
      keywords: ['compact', 'comfortable', 'spacious', 'rows', 'spacing'],
    },
    {
      id: 'appearance.timeFormat',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.timeFormat.title', 'Default time format'),
      description: t('search.entries.appearance.timeFormat.desc', 'Show timestamps as relative ("2h ago") or absolute ("Nov 12, 13:42").'),
      keywords: ['relative', 'absolute', 'timestamp', 'date', 'time'],
    },
    {
      id: 'appearance.chartPalette',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.chartPalette.title', 'Chart palette'),
      description: t('search.entries.appearance.chartPalette.desc', 'Color-blind safe (Okabe-Ito) or stylistic neon chart colors.'),
      keywords: ['cb', 'colorblind', 'okabe', 'neon', 'colors'],
    },
    {
      id: 'appearance.statusBar',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.statusBar.title', 'Status bar'),
      description: t('search.entries.appearance.statusBar.desc', 'Show or hide the always-on footer status bar.'),
      keywords: ['footer', 'health', 'bar'],
    },
    {
      id: 'appearance.celebrations',
      href: '/settings#appearance',
      section: 'appearance',
      title: t('search.entries.appearance.celebrations.title', 'Achievement celebrations'),
      description: t('search.entries.appearance.celebrations.desc', 'Celebration toasts and sound when an achievement unlocks.'),
      keywords: ['confetti', 'sound', 'achievement', 'unlock'],
    },

    // ── Security (TOTP) ─────────────────────────────────────────────
    {
      id: 'security.totp.enroll',
      href: '/account/2fa',
      section: 'security',
      title: t('search.entries.security.totpEnroll.title', 'Enable two-factor authentication'),
      description: t(
        'search.entries.security.totpEnroll.desc',
        'Set up TOTP from your authenticator app to protect destructive admin actions.',
      ),
      keywords: ['totp', '2fa', 'mfa', 'authenticator', 'security', 'sudo', 'step-up'],
    },
    {
      id: 'security.totp.backupCodes',
      href: '/account/2fa',
      section: 'security',
      title: t('search.entries.security.totpBackupCodes.title', 'TOTP backup codes'),
      description: t(
        'search.entries.security.totpBackupCodes.desc',
        'Regenerate or download the backup codes used when you lose access to your authenticator.',
      ),
      keywords: ['backup', 'recovery', 'codes', 'totp', '2fa'],
    },
    {
      id: 'security.totp.disable',
      href: '/account/2fa',
      section: 'security',
      title: t('search.entries.security.totpDisable.title', 'Disable two-factor authentication'),
      description: t(
        'search.entries.security.totpDisable.desc',
        'Remove the TOTP credential and revoke all backup codes for the current subject.',
      ),
      keywords: ['disable', 'remove', 'totp', '2fa', 'unenroll'],
    },
    // Active sessions / device management.
    {
      id: 'security.sessions.list',
      href: '/account/sessions',
      section: 'security',
      title: t('search.entries.security.sessionsList.title', 'Active sessions'),
      description: t(
        'search.entries.security.sessionsList.desc',
        'See which browsers and devices are currently signed in to TeslaSync and revoke individual sessions.',
      ),
      keywords: ['session', 'device', 'browser', 'sign out', 'logout', 'revoke', 'cookie'],
    },
    {
      id: 'security.sessions.revokeAll',
      href: '/account/sessions',
      section: 'security',
      title: t('search.entries.security.sessionsRevokeAll.title', 'Sign out all other devices'),
      description: t(
        'search.entries.security.sessionsRevokeAll.desc',
        'Revoke every TeslaSync session except the current browser. Useful after a lost laptop or shared computer.',
      ),
      keywords: ['logout', 'revoke', 'session', 'everywhere', 'all devices', 'security'],
    },

    // ── Privacy (browser-local data) ────────────────────────────────
    {
      id: 'privacy.recentPages.clear',
      href: '/account/privacy',
      section: 'privacy',
      title: t('search.entries.privacy.recentPagesClear.title', 'Clear recently viewed pages'),
      description: t(
        'search.entries.privacy.recentPagesClear.desc',
        'Wipe the local list of pages used by the status bar and the Recent section in the command palette.',
      ),
      keywords: ['recent', 'history', 'clear', 'wipe', 'pages', 'palette', 'status bar', 'footer'],
    },
    {
      id: 'privacy.consent.manage',
      href: '/account/privacy',
      section: 'privacy',
      title: t('search.entries.privacy.consentManage.title', 'Cookies & analytics consent'),
      description: t(
        'search.entries.privacy.consentManage.desc',
        'Re-grant, withdraw, or reset the cookie / analytics consent banner state for this browser.',
      ),
      keywords: ['cookies', 'consent', 'gdpr', 'analytics', 'tracking', 'banner', 'opt-in', 'opt-out'],
    },

    // ── Advanced ────────────────────────────────────────────────────
    {
      id: 'advanced.restoreConfirms',
      href: '/settings#advanced',
      section: 'advanced',
      title: t('search.entries.advanced.restoreConfirms.title', 'Restore confirmation prompts'),
      description: t('search.entries.advanced.restoreConfirms.desc', 'Re-enable “Don’t ask again” prompts you previously silenced.'),
      keywords: ['confirm', 'dialog', 'silence', 'dont ask', 'reset', 'restore'],
    },

    // ── Backup & Restore — moved to dedicated /backup page ──────────
    // Promoted out of SettingsPage to live alongside operational backup
    // runs in features/admin/pages/
    // BackupRestorePage so the DATA category owns every backup surface.
    {
      id: 'backup.export',
      href: '/backup',
      section: 'backup',
      title: t('search.entries.backup.export.title', 'Export settings as JSON'),
      description: t('search.entries.backup.export.desc', 'Download a portable bundle of general settings, alert rules, geofences, and quiet-hours windows.'),
      keywords: ['backup', 'download', 'json', 'save', 'snapshot', 'configuration'],
    },
    {
      id: 'backup.import',
      href: '/backup',
      section: 'backup',
      title: t('search.entries.backup.import.title', 'Import settings from JSON'),
      description: t('search.entries.backup.import.desc', 'Restore alert rules, geofences, and quiet-hours windows from a previously exported bundle.'),
      keywords: ['restore', 'upload', 'json', 'load', 'recover', 'configuration'],
    },
    // ── Webhook channels ────────────────────────────────────────────
    {
      id: 'webhooks.list',
      href: '/notifications/webhooks',
      section: 'webhooks',
      title: t('search.entries.webhooks.list.title', 'Webhook channels'),
      description: t(
        'search.entries.webhooks.list.desc',
        'Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver.',
      ),
      keywords: [
        'webhook',
        'discord',
        'slack',
        'n8n',
        'home assistant',
        'http',
        'integration',
        'automation',
      ],
    },
    {
      id: 'webhooks.signing',
      href: '/notifications/webhooks',
      section: 'webhooks',
      title: t('search.entries.webhooks.signing.title', 'Webhook HMAC signing'),
      description: t(
        'search.entries.webhooks.signing.desc',
        'Sign outbound webhooks with a shared secret so receivers can verify authenticity via the X-TeslaSync-Signature header.',
      ),
      keywords: ['hmac', 'sign', 'signature', 'sha256', 'secret', 'verify', 'authenticity'],
    },
    {
      id: 'webhooks.test',
      href: '/notifications/webhooks',
      section: 'webhooks',
      title: t('search.entries.webhooks.test.title', 'Test a webhook channel'),
      description: t(
        'search.entries.webhooks.test.desc',
        'Fire a test event at a configured webhook to verify your receiver and signature pipeline.',
      ),
      keywords: ['test', 'fire', 'verify', 'debug', 'try'],
    },
    // ── Reset to defaults ───────────────────────────────────────────
    {
      id: 'reset.section',
      href: '/settings#reset',
      section: 'reset',
      title: t('search.entries.reset.section.title', 'Reset a section to defaults'),
      description: t(
        'search.entries.reset.section.desc',
        'Wipe one section at a time — alert rules, geofences, channels, automations, dashboard layouts, quiet hours, or general/appearance preferences.',
      ),
      keywords: [
        'reset',
        'defaults',
        'wipe',
        'clear',
        'restore',
        'factory',
        'erase',
      ],
    },
    {
      id: 'reset.all',
      href: '/settings#reset',
      section: 'reset',
      title: t('search.entries.reset.all.title', 'Reset ALL settings'),
      description: t(
        'search.entries.reset.all.desc',
        'Danger zone — wipe every user-discoverable preference, alert rule, channel, geofence, automation, and dashboard layout in one transaction. Requires typing RESET to confirm.',
      ),
      keywords: [
        'reset',
        'all',
        'danger',
        'wipe',
        'nuke',
        'factory',
        'erase',
        'fresh start',
      ],
    },
    // ── Helix (AI integration, lives on its own page) ───────────────
    // Cross-page entry: clicking it navigates to /integrations/helix
    // rather than scrolling to an anchor on /settings. Kept here so
    // users who think of AI/Helix as a "setting" still find it from
    // the settings search box.
    {
      id: 'helix.integration',
      href: '/integrations/helix',
      section: 'integrations',
      title: t('search.entries.helix.integration.title', 'Helix (AI integration)'),
      description: t(
        'search.entries.helix.integration.desc',
        'Optional AI integration — provider, API key, cost cap, and per-feature opt-in toggles. Off by default.',
      ),
      keywords: [
        'ai',
        'helix',
        'assistant',
        'llm',
        'gpt',
        'openai',
        'anthropic',
        'chatbot',
        'provider',
        'cost cap',
        'api key',
        'model',
      ],
    },
  ];
}

/**
 * Case-insensitive subsequence match. Returns true when every character
 * of `needle` appears in `haystack` in order (e.g. "lng" → "Language").
 *
 * Empty needles never match (the caller is expected to short-circuit on
 * empty queries), so an empty haystack never matches anything either.
 * Nullish inputs are coerced to empty strings rather than throwing.
 */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  if (!needle) return false;
  const n = needle.toLowerCase();
  const h = (haystack ?? '').toLowerCase();
  let i = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}

/**
 * Score and filter the settings index against a query. Substring matches
 * on title/description/keywords rank higher than fuzzy subsequence
 * matches, and title hits beat description hits within each tier.
 *
 * Returned entries are pre-sorted by descending score. Callers typically
 * cap the list (e.g. `.slice(0, 8)`) before rendering.
 */
export function searchSettings(index: readonly SettingsEntry[], query: string): SettingsEntry[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return [];

  type Scored = { entry: SettingsEntry; score: number };
  const scored: Scored[] = [];

  for (const entry of index ?? []) {
    const title = (entry.title ?? '').toLowerCase();
    const desc = (entry.description ?? '').toLowerCase();
    const keywordHit = (entry.keywords ?? []).some((k) => k.toLowerCase().includes(q));

    let score = 0;
    if (title === q) score = 1000;
    else if (title.startsWith(q)) score = 800;
    else if (title.includes(q)) score = 600;
    else if (keywordHit) score = 400;
    else if (desc.includes(q)) score = 300;
    else if (fuzzyMatch(q, title)) score = 200;
    else if (fuzzyMatch(q, desc)) score = 100;

    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}
