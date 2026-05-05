// Phase-45 / Prompt 24 — Settings find-as-you-type index.
//
// Each entry maps a single user-discoverable setting to the section
// anchor that contains its control. The `<SettingsSearch>` component
// uses substring + fuzzy-subsequence matching against `title`,
// `description`, and `keywords` to surface the right entry as the
// user types.
//
// Adding a new entry
// ------------------
// 1. Add the section's `id="..."` anchor to `SettingsPage.tsx` if it
//    doesn't already exist.
// 2. Append an entry below with a stable `id` slug, the anchor `href`,
//    and human-meaningful `title`/`description`/`keywords` so users
//    typing common synonyms (e.g. "psi" for tire pressure unit)
//    still find the right setting.

import type { TFunction } from 'i18next';

export interface SettingsEntry {
  /** Stable slug. Used as the React key and for analytics if added later. */
  id: string;
  /** Anchor href, e.g. `/settings#appearance`. Must match a `<section id>` rendered on the settings page. */
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
      href: '/settings#tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.connect.title', 'Connect Tesla account'),
      description: t('search.entries.tesla.connect.desc', 'Authorize TeslaSync to access your Tesla account.'),
      keywords: ['oauth', 'login', 'authorize', 'sign in'],
    },
    {
      id: 'tesla.refresh-token',
      href: '/settings#tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.refreshToken.title', 'Tesla refresh token'),
      description: t('search.entries.tesla.refreshToken.desc', 'Manually refresh the cached Tesla OAuth token.'),
      keywords: ['oauth', 'token', 'auth'],
    },
    {
      id: 'tesla.disconnect',
      href: '/settings#tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.disconnect.title', 'Disconnect Tesla account'),
      description: t('search.entries.tesla.disconnect.desc', 'Sign out and remove the cached OAuth token.'),
      keywords: ['logout', 'sign out', 'remove'],
    },
    {
      id: 'tesla.sync-vehicles',
      href: '/settings#tesla-account',
      section: 'tesla',
      title: t('search.entries.tesla.syncVehicles.title', 'Sync vehicles from Tesla'),
      description: t('search.entries.tesla.syncVehicles.desc', 'Pull the current vehicle list from the Tesla Fleet API.'),
      keywords: ['vin', 'cars', 'fleet'],
    },

    // ── Region & API ────────────────────────────────────────────────
    {
      id: 'region.fleet-api',
      href: '/settings#region',
      section: 'region',
      title: t('search.entries.region.title', 'Region & Fleet API endpoint'),
      description: t('search.entries.region.desc', 'Tesla account region and the resolved Fleet API base URL.'),
      keywords: ['country', 'tld', 'endpoint', 'na', 'eu'],
    },

    // ── Feature flags ───────────────────────────────────────────────
    {
      id: 'features.flags',
      href: '/settings#features',
      section: 'features',
      title: t('search.entries.features.title', 'Feature flags'),
      description: t('search.entries.features.desc', 'Tesla account feature configuration synced from the Fleet API.'),
      keywords: ['premium', 'subscription', 'config'],
    },

    // ── Active orders ───────────────────────────────────────────────
    {
      id: 'orders.active',
      href: '/settings#orders',
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
    {
      id: 'general.google-maps',
      href: '/settings#general',
      section: 'general',
      title: t('search.entries.general.googleMaps.title', 'Google Maps API key'),
      description: t('search.entries.general.googleMaps.desc', 'Optional key enabling satellite views and Places autocomplete.'),
      keywords: ['maps', 'api key', 'satellite', 'places'],
    },

    // ── Gas price auto-poll ─────────────────────────────────────────
    {
      id: 'gas-price.auto-poll',
      href: '/settings#gas-price',
      section: 'gas-price',
      title: t('search.entries.gasPrice.title', 'Gas price auto-poll'),
      description: t('search.entries.gasPrice.desc', 'Automatically fetch US average gas prices from EIA.'),
      keywords: ['eia', 'fuel', 'poll', 'auto'],
    },

    // ── Notifications ───────────────────────────────────────────────
    {
      id: 'notifications.browser-permission',
      href: '/settings#notifications',
      section: 'notifications',
      title: t('search.entries.notifications.browser.title', 'Browser notifications'),
      description: t('search.entries.notifications.browser.desc', 'Enable browser notifications when the tab is in the background.'),
      keywords: ['push', 'permission', 'desktop'],
    },
    {
      id: 'notifications.alerts',
      href: '/settings#notifications',
      section: 'notifications',
      title: t('search.entries.notifications.alerts.title', 'Alert notifications'),
      description: t('search.entries.notifications.alerts.desc', 'Get notified when an alert rule fires.'),
      keywords: ['rules', 'alarm', 'warning'],
    },
    {
      id: 'notifications.export-status',
      href: '/settings#notifications',
      section: 'notifications',
      title: t('search.entries.notifications.exportStatus.title', 'Export completion notifications'),
      description: t('search.entries.notifications.exportStatus.desc', 'Get notified when a CSV/JSON export finishes.'),
      keywords: ['export', 'download', 'csv', 'json'],
    },
    {
      id: 'notifications.tab-badge',
      href: '/settings#notifications',
      section: 'notifications',
      title: t('search.entries.notifications.tabBadge.title', 'Browser tab unread badge'),
      description: t('search.entries.notifications.tabBadge.desc', 'Show unread count in the browser tab title and favicon.'),
      keywords: ['favicon', 'count', 'tab'],
    },
    {
      id: 'notifications.critical-flash',
      href: '/settings#notifications',
      section: 'notifications',
      title: t('search.entries.notifications.criticalFlash.title', 'Critical alert tab flash'),
      description: t('search.entries.notifications.criticalFlash.desc', 'Flash the browser tab title on critical alerts.'),
      keywords: ['flash', 'urgent', 'tab'],
    },

    // ── Quiet hours / Do-Not-Disturb (Phase-46 / Prompt 19) ──────────
    {
      id: 'quiet-hours.windows',
      href: '/settings#quiet-hours',
      section: 'quiet-hours',
      title: t('search.entries.quietHours.windows.title', 'Quiet hours windows'),
      description: t('search.entries.quietHours.windows.desc', 'Defer non-critical notifications during sleep, work meetings, or any time-of-day window.'),
      keywords: ['dnd', 'do not disturb', 'sleep', 'mute', 'silence', 'night'],
    },
    {
      id: 'quiet-hours.bypass-severities',
      href: '/settings#quiet-hours',
      section: 'quiet-hours',
      title: t('search.entries.quietHours.bypass.title', 'Quiet hours bypass severities'),
      description: t('search.entries.quietHours.bypass.desc', 'Choose which severities (e.g. critical) still ring through during quiet hours.'),
      keywords: ['critical', 'override', 'bypass', 'severity'],
    },
    {
      id: 'quiet-hours.timezone',
      href: '/settings#quiet-hours',
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

    // ── Advanced ────────────────────────────────────────────────────
    {
      id: 'advanced.restoreConfirms',
      href: '/settings#advanced',
      section: 'advanced',
      title: t('search.entries.advanced.restoreConfirms.title', 'Restore confirmation prompts'),
      description: t('search.entries.advanced.restoreConfirms.desc', 'Re-enable “Don’t ask again” prompts you previously silenced.'),
      keywords: ['confirm', 'dialog', 'silence', 'dont ask', 'reset', 'restore'],
    },
  ];
}

/**
 * Case-insensitive subsequence match. Returns true when every character
 * of `needle` appears in `haystack` in order (e.g. "lng" → "Language").
 *
 * Empty needles never match (the caller is expected to short-circuit on
 * empty queries) and an empty haystack only matches the empty needle.
 */
export function fuzzyMatch(needle: string, haystack: string): boolean {
  if (needle.length === 0) return false;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
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
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  type Scored = { entry: SettingsEntry; score: number };
  const scored: Scored[] = [];

  for (const entry of index) {
    const title = entry.title.toLowerCase();
    const desc = entry.description.toLowerCase();
    const keywordHit = (entry.keywords ?? []).some((k) => k.toLowerCase().includes(q));

    let score = 0;
    if (title === q) score = 1000;
    else if (title.startsWith(q)) score = 800;
    else if (title.includes(q)) score = 600;
    else if (keywordHit) score = 400;
    else if (desc.includes(q)) score = 300;
    else if (fuzzyMatch(q, entry.title)) score = 200;
    else if (fuzzyMatch(q, entry.description)) score = 100;

    if (score > 0) scored.push({ entry, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.entry);
}
