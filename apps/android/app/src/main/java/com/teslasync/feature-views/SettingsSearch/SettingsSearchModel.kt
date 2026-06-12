// Pure, framework-free model + projection + diagnostics for the SettingsSearch feature view — the native
// analogue of everything the web component and its companion index derive before returning JSX
// (web/src/features/settings/components/SettingsSearch.tsx + web/src/features/settings/searchIndex.ts).
// No Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :app:testReleaseUnitTest gate, so the composable stays a thin render layer over deterministic logic.
//
// SettingsSearch is the settings page's find-as-you-type box. Its ONLY web hooks are `useTranslation`,
// `useNavigate`, and `useId`; it binds NO data hook and performs NO fetch. As in the sibling QuickNav /
// RegexTester / ToolCard ports (the other zero-data-source surfaces), there is therefore no loading /
// error / stale / offline data lifecycle to model — inventing those states would fabricate behaviour the
// web spec does not have (honesty covenant §9, no silent drift). What the surface genuinely varies is
// the dropdown it shows for the current query: nothing while the field is empty (web
// `showDropdown = open && query.length > 0`), the ranked match rows when something matches, or a friendly
// "No matching settings." row when the query matches nothing — never a hidden surface. This pure file owns
// the parts the web render derives before returning JSX:
//   • the canonical settings index — the web `getSettingsIndex(t)` array (53 entries), each carrying its
//     navigation target (web `href`), section, i18n title/description keys + English defaults, and the
//     static keyword synonyms the web hard-codes (NOT translated);
//   • the match ranking — the web `searchSettings(index, query)` (substring > keyword > description >
//     fuzzy-subsequence, title beating description within each tier) and its `fuzzyMatch` helper;
//   • the dropdown projection — the web `matches.slice(0, MAX_RESULTS)` cap plus the idle / results / empty
//     branch the component renders.
//
// i18n parity: the web `getSettingsIndex(t)` resolves each title/description through `t(key, default)`. The
// pure [SettingsSearchCatalog.buildIndex] mirrors that exactly via an injected `resolve(key, default)` seam:
// the off-device test passes `{ _, default -> default }` (the web test's `tStub = (_k, d) => d`) so the
// ranking is verified against the English wording, and the Compose boundary passes a resolver backed by the
// P1/S10 catalog that falls back to the same English default when a key is absent (e.g. the privacy/helix
// entries the generated catalog does not yet carry) — exactly as i18next's `t(key, default)` does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SettingsSearch — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AddressInput / QuickNav / RegexTester
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.settingssearch

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The maximum number of match rows the dropdown shows — the web `MAX_RESULTS = 8`. The ranked match list is
 * capped to this before rendering so a broad query never floods the popover.
 */
const val MAX_RESULTS: Int = 8

/**
 * The mutually-exclusive dropdown surface for the current query — the native analogue of the web component's
 * conditional render. SettingsSearch is purely synchronous (no fetch), so this carries only the branches the
 * web spec actually has; there is deliberately no loading/error/stale/offline member (see the file header).
 */
enum class SettingsSearchStatus {
    /** The query is empty (web `query.length > 0` is false) — the dropdown is not shown at all. */
    Idle,

    /** One or more settings matched the query — the ranked, capped match rows are shown. */
    Results,

    /** The query matched no settings — a single friendly "No matching settings." row, never a blank menu. */
    Empty,
}

/**
 * One render-ready settings entry — the native mirror of a web `SettingsEntry` (searchIndex.ts) after its
 * title/description have been resolved through `t()`. Pure data (no Compose/Android types) so the index and
 * ranking are fully covered by the off-device unit gate.
 *
 * @property id stable slug — the web `id` (the dropdown row key + the diagnostics-free analytics handle).
 * @property route the navigation target — the web `href` (e.g. `/settings#appearance`, `/tesla-account`,
 *   `/integrations/helix`); emitted verbatim to the host on selection so the view stays decoupled from
 *   navigation, exactly as the sibling QuickNav port emits its destination.
 * @property section the section slug this entry belongs to — the web `section` (grouping / future labels).
 * @property title the resolved title shown on the dropdown row's first line (web `title`).
 * @property description the resolved description shown on the second line + matched in search (web `description`).
 * @property keywords static synonyms/abbreviations matched in search but not displayed — the web `keywords`
 *   array, which the web hard-codes in English and never passes through `t()`.
 */
data class SettingsSearchEntry(
    val id: String,
    val route: String,
    val section: String,
    val title: String,
    val description: String,
    val keywords: List<String> = emptyList(),
)

/**
 * The fully projected, render-ready dropdown state — everything the web component computes before mapping
 * options into the listbox.
 *
 * @property status the dropdown branch to render (idle / results / empty).
 * @property entries the ranked, [MAX_RESULTS]-capped match rows; empty for every non-Results status.
 */
data class SettingsSearchResults(
    val status: SettingsSearchStatus,
    val entries: List<SettingsSearchEntry> = emptyList(),
)

/**
 * One settings index entry's pre-resolution metadata — the web `SettingsEntry` with its title/description
 * still as `(i18n key, English default)` pairs rather than resolved strings. Private because callers only
 * ever consume the resolved [SettingsSearchEntry] produced by [SettingsSearchCatalog.buildIndex].
 */
private data class CatalogEntry(
    val id: String,
    val route: String,
    val section: String,
    val title: Localized,
    val description: Localized,
    val keywords: List<String>,
)

/** An i18n key paired with its English default — the two arguments of a web `t(key, default)` call. */
private data class Localized(
    val key: String,
    val default: String,
)

/**
 * The canonical settings index + its builder — the native analogue of the web `getSettingsIndex(t)`
 * (searchIndex.ts). The catalogue itself is a static `val` (the web array literal); [buildIndex] resolves
 * each entry's title/description through the injected `resolve` seam so the i18n lookup happens in exactly
 * one place and the pure ranking can be tested against the English defaults off-device.
 */
object SettingsSearchCatalog {
    /**
     * Builds the resolved settings index — the web `getSettingsIndex(t)`. Each title/description is resolved
     * via [resolve] (the web `t(key, default)`): the off-device test passes `{ _, default -> default }` (the
     * web `tStub`), while the Compose boundary passes a P1/S10 catalog resolver that falls back to the same
     * English default for any absent key. Keywords are carried verbatim (the web never translates them).
     *
     * @param resolve resolves an i18n `(key, default)` to the display string — the web `t(key, default)`.
     */
    fun buildIndex(resolve: (key: String, default: String) -> String): List<SettingsSearchEntry> =
        CATALOG.map { entry ->
            SettingsSearchEntry(
                id = entry.id,
                route = entry.route,
                section = entry.section,
                title = resolve(entry.title.key, entry.title.default),
                description = resolve(entry.description.key, entry.description.default),
                keywords = entry.keywords,
            )
        }

    // The 53 indexed settings, in the exact web order (searchIndex.ts `getSettingsIndex` return array). A
    // static `val` rather than a function so the long literal is a property initializer (not a method body).
    private val CATALOG: List<CatalogEntry> =
        listOf(
            // ── Tesla account ───────────────────────────────────────────────
            CatalogEntry(
                id = "tesla.connect",
                route = "/tesla-account",
                section = "tesla",
                title = Localized("search.entries.tesla.connect.title", "Connect Tesla account"),
                description = Localized("search.entries.tesla.connect.desc", "Authorize TeslaSync to access your Tesla account."),
                keywords = listOf("oauth", "login", "authorize", "sign in"),
            ),
            CatalogEntry(
                id = "tesla.refresh-token",
                route = "/tesla-account",
                section = "tesla",
                title = Localized("search.entries.tesla.refreshToken.title", "Tesla refresh token"),
                description = Localized("search.entries.tesla.refreshToken.desc", "Manually refresh the cached Tesla OAuth token."),
                keywords = listOf("oauth", "token", "auth"),
            ),
            CatalogEntry(
                id = "tesla.disconnect",
                route = "/tesla-account",
                section = "tesla",
                title = Localized("search.entries.tesla.disconnect.title", "Disconnect Tesla account"),
                description = Localized("search.entries.tesla.disconnect.desc", "Sign out and remove the cached OAuth token."),
                keywords = listOf("logout", "sign out", "remove"),
            ),
            CatalogEntry(
                id = "tesla.sync-vehicles",
                route = "/tesla-account",
                section = "tesla",
                title = Localized("search.entries.tesla.syncVehicles.title", "Sync vehicles from Tesla"),
                description =
                    Localized(
                        "search.entries.tesla.syncVehicles.desc",
                        "Pull the current vehicle list from the Tesla Fleet API.",
                    ),
                keywords = listOf("vin", "cars", "fleet"),
            ),
            // ── Region & API ────────────────────────────────────────────────
            CatalogEntry(
                id = "region.fleet-api",
                route = "/tesla-region",
                section = "region",
                title = Localized("search.entries.region.title", "Region & Fleet API endpoint"),
                description = Localized("search.entries.region.desc", "Tesla account region and the resolved Fleet API base URL."),
                keywords = listOf("country", "tld", "endpoint", "na", "eu"),
            ),
            // ── Feature flags ───────────────────────────────────────────────
            CatalogEntry(
                id = "features.flags",
                route = "/tesla-features",
                section = "features",
                title = Localized("search.entries.features.title", "Feature flags"),
                description = Localized("search.entries.features.desc", "Tesla account feature configuration synced from the Fleet API."),
                keywords = listOf("premium", "subscription", "config"),
            ),
            // ── Active orders ───────────────────────────────────────────────
            CatalogEntry(
                id = "orders.active",
                route = "/tesla-orders",
                section = "orders",
                title = Localized("search.entries.orders.title", "Active orders"),
                description = Localized("search.entries.orders.desc", "Vehicle orders and delivery tracking from Tesla."),
                keywords = listOf("delivery", "order", "reservation"),
            ),
            // ── General — units & cost ──────────────────────────────────────
            CatalogEntry(
                id = "general.units.distance",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.distance.title", "Distance unit"),
                description = Localized("search.entries.general.distance.desc", "Show distances in kilometers or miles."),
                keywords = listOf("km", "mi", "metric", "imperial"),
            ),
            CatalogEntry(
                id = "general.units.temperature",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.temperature.title", "Temperature unit"),
                description = Localized("search.entries.general.temperature.desc", "Show temperatures in Celsius or Fahrenheit."),
                keywords = listOf("celsius", "fahrenheit", "c", "f"),
            ),
            CatalogEntry(
                id = "general.units.pressure",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.pressure.title", "Tire pressure unit"),
                description = Localized("search.entries.general.pressure.desc", "Show tire pressure in Bar or PSI."),
                keywords = listOf("psi", "bar", "tire", "tyre"),
            ),
            CatalogEntry(
                id = "general.range",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.range.title", "Preferred range"),
                description = Localized("search.entries.general.range.desc", "Display rated or ideal range for the battery."),
                keywords = listOf("ideal", "rated", "epa"),
            ),
            CatalogEntry(
                id = "general.precision",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.precision.title", "Decimal precision"),
                description = Localized("search.entries.general.precision.desc", "Number of decimal places shown on numeric metrics."),
                keywords = listOf("decimals", "rounding", "sig figs"),
            ),
            CatalogEntry(
                id = "general.language",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.language.title", "Language"),
                description = Localized("search.entries.general.language.desc", "Application interface language."),
                keywords = listOf("locale", "translation", "i18n"),
            ),
            CatalogEntry(
                id = "general.currency",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.currency.title", "Currency"),
                description = Localized("search.entries.general.currency.desc", "Currency symbol used in cost and savings displays."),
                keywords = listOf("usd", "eur", "gbp", "money"),
            ),
            CatalogEntry(
                id = "general.locale",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.locale.title", "Number & date locale"),
                description = Localized("search.entries.general.locale.desc", "Locale used for number, date, and time formatting."),
                keywords = listOf("format", "thousand separator", "comma"),
            ),
            CatalogEntry(
                id = "general.timezone",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.timezone.title", "Time zone"),
                description =
                    Localized(
                        "search.entries.general.timezone.desc",
                        "Whether timestamps follow the vehicle, your local time, or UTC.",
                    ),
                keywords = listOf("tz", "utc", "local", "iana"),
            ),
            CatalogEntry(
                id = "general.electricity-cost",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.electricityCost.title", "Electricity cost (per kWh)"),
                description = Localized("search.entries.general.electricityCost.desc", "Per-kWh price used in charging cost calculations."),
                keywords = listOf("kwh", "price", "rate", "cost"),
            ),
            CatalogEntry(
                id = "general.gas-price",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.gasPriceManual.title", "Comparison gas price"),
                description =
                    Localized(
                        "search.entries.general.gasPriceManual.desc",
                        "Manual gas price used in EV-vs-ICE savings comparisons.",
                    ),
                keywords = listOf("fuel", "gallon", "liter", "gasoline"),
            ),
            CatalogEntry(
                id = "general.mpg",
                route = "/settings#general",
                section = "general",
                title = Localized("search.entries.general.mpg.title", "Comparison vehicle MPG"),
                description =
                    Localized(
                        "search.entries.general.mpg.desc",
                        "Average MPG of the equivalent gas car for savings calculations.",
                    ),
                keywords = listOf("fuel economy", "efficiency", "mpg"),
            ),
            // ── Gas price auto-poll ─────────────────────────────────────────
            CatalogEntry(
                id = "gas-price.auto-poll",
                route = "/gas-price",
                section = "gas-price",
                title = Localized("search.entries.gasPrice.title", "Gas price auto-poll"),
                description = Localized("search.entries.gasPrice.desc", "Automatically fetch US average gas prices from EIA."),
                keywords = listOf("eia", "fuel", "poll", "auto"),
            ),
            // ── Notifications ───────────────────────────────────────────────
            CatalogEntry(
                id = "notifications.browser-permission",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.browser.title", "Browser notifications"),
                description =
                    Localized(
                        "search.entries.notifications.browser.desc",
                        "Enable browser notifications when the tab is in the background.",
                    ),
                keywords = listOf("push", "permission", "desktop"),
            ),
            CatalogEntry(
                id = "notifications.alerts",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.alerts.title", "Alert notifications"),
                description = Localized("search.entries.notifications.alerts.desc", "Get notified when an alert rule fires."),
                keywords = listOf("rules", "alarm", "warning"),
            ),
            CatalogEntry(
                id = "notifications.export-status",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.exportStatus.title", "Export completion notifications"),
                description = Localized("search.entries.notifications.exportStatus.desc", "Get notified when a CSV/JSON export finishes."),
                keywords = listOf("export", "download", "csv", "json"),
            ),
            CatalogEntry(
                id = "notifications.tab-badge",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.tabBadge.title", "Browser tab unread badge"),
                description =
                    Localized(
                        "search.entries.notifications.tabBadge.desc",
                        "Show unread count in the browser tab title and favicon.",
                    ),
                keywords = listOf("favicon", "count", "tab"),
            ),
            CatalogEntry(
                id = "notifications.critical-flash",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.criticalFlash.title", "Critical alert tab flash"),
                description =
                    Localized(
                        "search.entries.notifications.criticalFlash.desc",
                        "Flash the browser tab title on critical alerts.",
                    ),
                keywords = listOf("flash", "urgent", "tab"),
            ),
            CatalogEntry(
                id = "notifications.sound-master",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.soundMaster.title", "Notification sounds"),
                description =
                    Localized(
                        "search.entries.notifications.soundMaster.desc",
                        "Play short audio cues when alerts and completion events arrive.",
                    ),
                keywords = listOf("audio", "sound", "chime", "beep", "noise", "mute", "volume"),
            ),
            CatalogEntry(
                id = "notifications.sound-channels",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.soundChannels.title", "Per-channel notification sounds"),
                description =
                    Localized(
                        "search.entries.notifications.soundChannels.desc",
                        "Toggle sound separately for critical, warning, and info alerts plus charge/drive/automation completions.",
                    ),
                keywords = listOf("critical", "warning", "info", "channel", "category", "audio", "cue"),
            ),
            CatalogEntry(
                id = "notifications.sound-volume",
                route = "/notifications/browser",
                section = "notifications",
                title = Localized("search.entries.notifications.soundVolume.title", "Notification sound volume"),
                description = Localized("search.entries.notifications.soundVolume.desc", "Adjust how loud notification cues play."),
                keywords = listOf("volume", "loud", "quiet", "audio", "level"),
            ),
            // ── Quiet hours / Do-Not-Disturb ────────────────────────────────
            CatalogEntry(
                id = "quiet-hours.windows",
                route = "/notifications/quiet-hours",
                section = "quiet-hours",
                title = Localized("search.entries.quietHours.windows.title", "Quiet hours windows"),
                description =
                    Localized(
                        "search.entries.quietHours.windows.desc",
                        "Defer non-critical notifications during sleep, work meetings, or any time-of-day window.",
                    ),
                keywords = listOf("dnd", "do not disturb", "sleep", "mute", "silence", "night"),
            ),
            CatalogEntry(
                id = "quiet-hours.bypass-severities",
                route = "/notifications/quiet-hours",
                section = "quiet-hours",
                title = Localized("search.entries.quietHours.bypass.title", "Quiet hours bypass severities"),
                description =
                    Localized(
                        "search.entries.quietHours.bypass.desc",
                        "Choose which severities (e.g. critical) still ring through during quiet hours.",
                    ),
                keywords = listOf("critical", "override", "bypass", "severity"),
            ),
            CatalogEntry(
                id = "quiet-hours.timezone",
                route = "/notifications/quiet-hours",
                section = "quiet-hours",
                title = Localized("search.entries.quietHours.timezone.title", "Quiet hours timezone"),
                description =
                    Localized(
                        "search.entries.quietHours.timezone.desc",
                        "Pick the IANA timezone the start/end times are evaluated against.",
                    ),
                keywords = listOf("tz", "timezone", "iana", "utc"),
            ),
            // ── Appearance ──────────────────────────────────────────────────
            CatalogEntry(
                id = "appearance.theme",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.theme.title", "Theme"),
                description =
                    Localized(
                        "search.entries.appearance.theme.desc",
                        "Choose light, dark, or system mode and pick an accent color.",
                    ),
                keywords = listOf("dark", "light", "color", "accent", "mode"),
            ),
            CatalogEntry(
                id = "appearance.density",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.density.title", "Information density"),
                description =
                    Localized(
                        "search.entries.appearance.density.desc",
                        "Compact, comfortable, or spacious row sizing across tables and cards.",
                    ),
                keywords = listOf("compact", "comfortable", "spacious", "rows", "spacing"),
            ),
            CatalogEntry(
                id = "appearance.timeFormat",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.timeFormat.title", "Default time format"),
                description =
                    Localized(
                        "search.entries.appearance.timeFormat.desc",
                        "Show timestamps as relative (\"2h ago\") or absolute (\"Nov 12, 13:42\").",
                    ),
                keywords = listOf("relative", "absolute", "timestamp", "date", "time"),
            ),
            CatalogEntry(
                id = "appearance.chartPalette",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.chartPalette.title", "Chart palette"),
                description =
                    Localized(
                        "search.entries.appearance.chartPalette.desc",
                        "Color-blind safe (Okabe-Ito) or stylistic neon chart colors.",
                    ),
                keywords = listOf("cb", "colorblind", "okabe", "neon", "colors"),
            ),
            CatalogEntry(
                id = "appearance.statusBar",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.statusBar.title", "Status bar"),
                description = Localized("search.entries.appearance.statusBar.desc", "Show or hide the always-on footer status bar."),
                keywords = listOf("footer", "health", "bar"),
            ),
            CatalogEntry(
                id = "appearance.celebrations",
                route = "/settings#appearance",
                section = "appearance",
                title = Localized("search.entries.appearance.celebrations.title", "Achievement celebrations"),
                description =
                    Localized(
                        "search.entries.appearance.celebrations.desc",
                        "Celebration toasts and sound when an achievement unlocks.",
                    ),
                keywords = listOf("confetti", "sound", "achievement", "unlock"),
            ),
            // ── Security (TOTP) ─────────────────────────────────────────────
            CatalogEntry(
                id = "security.totp.enroll",
                route = "/account/2fa",
                section = "security",
                title = Localized("search.entries.security.totpEnroll.title", "Enable two-factor authentication"),
                description =
                    Localized(
                        "search.entries.security.totpEnroll.desc",
                        "Set up TOTP from your authenticator app to protect destructive admin actions.",
                    ),
                keywords = listOf("totp", "2fa", "mfa", "authenticator", "security", "sudo", "step-up"),
            ),
            CatalogEntry(
                id = "security.totp.backupCodes",
                route = "/account/2fa",
                section = "security",
                title = Localized("search.entries.security.totpBackupCodes.title", "TOTP backup codes"),
                description =
                    Localized(
                        "search.entries.security.totpBackupCodes.desc",
                        "Regenerate or download the backup codes used when you lose access to your authenticator.",
                    ),
                keywords = listOf("backup", "recovery", "codes", "totp", "2fa"),
            ),
            CatalogEntry(
                id = "security.totp.disable",
                route = "/account/2fa",
                section = "security",
                title = Localized("search.entries.security.totpDisable.title", "Disable two-factor authentication"),
                description =
                    Localized(
                        "search.entries.security.totpDisable.desc",
                        "Remove the TOTP credential and revoke all backup codes for the current subject.",
                    ),
                keywords = listOf("disable", "remove", "totp", "2fa", "unenroll"),
            ),
            CatalogEntry(
                id = "security.sessions.list",
                route = "/account/sessions",
                section = "security",
                title = Localized("search.entries.security.sessionsList.title", "Active sessions"),
                description =
                    Localized(
                        "search.entries.security.sessionsList.desc",
                        "See which browsers and devices are currently signed in to TeslaSync and revoke individual sessions.",
                    ),
                keywords = listOf("session", "device", "browser", "sign out", "logout", "revoke", "cookie"),
            ),
            CatalogEntry(
                id = "security.sessions.revokeAll",
                route = "/account/sessions",
                section = "security",
                title = Localized("search.entries.security.sessionsRevokeAll.title", "Sign out all other devices"),
                description =
                    Localized(
                        "search.entries.security.sessionsRevokeAll.desc",
                        "Revoke every TeslaSync session except the current browser. Useful after a lost laptop or shared computer.",
                    ),
                keywords = listOf("logout", "revoke", "session", "everywhere", "all devices", "security"),
            ),
            // ── Privacy (browser-local data) ────────────────────────────────
            CatalogEntry(
                id = "privacy.recentPages.clear",
                route = "/account/privacy",
                section = "privacy",
                title = Localized("search.entries.privacy.recentPagesClear.title", "Clear recently viewed pages"),
                description =
                    Localized(
                        "search.entries.privacy.recentPagesClear.desc",
                        "Wipe the local list of pages used by the dashboard widget and the Recent section in the command palette.",
                    ),
                keywords = listOf("recent", "history", "clear", "wipe", "pages", "palette", "dashboard"),
            ),
            CatalogEntry(
                id = "privacy.consent.manage",
                route = "/account/privacy",
                section = "privacy",
                title = Localized("search.entries.privacy.consentManage.title", "Cookies & analytics consent"),
                description =
                    Localized(
                        "search.entries.privacy.consentManage.desc",
                        "Re-grant, withdraw, or reset the cookie / analytics consent banner state for this browser.",
                    ),
                keywords = listOf("cookies", "consent", "gdpr", "analytics", "tracking", "banner", "opt-in", "opt-out"),
            ),
            // ── Advanced ────────────────────────────────────────────────────
            CatalogEntry(
                id = "advanced.restoreConfirms",
                route = "/settings#advanced",
                section = "advanced",
                title = Localized("search.entries.advanced.restoreConfirms.title", "Restore confirmation prompts"),
                description =
                    Localized(
                        "search.entries.advanced.restoreConfirms.desc",
                        "Re-enable \u201CDon\u2019t ask again\u201D prompts you previously silenced.",
                    ),
                keywords = listOf("confirm", "dialog", "silence", "dont ask", "reset", "restore"),
            ),
            // ── Backup & Restore (dedicated /backup page) ───────────────────
            CatalogEntry(
                id = "backup.export",
                route = "/backup",
                section = "backup",
                title = Localized("search.entries.backup.export.title", "Export settings as JSON"),
                description =
                    Localized(
                        "search.entries.backup.export.desc",
                        "Download a portable bundle of general settings, alert rules, geofences, and quiet-hours windows.",
                    ),
                keywords = listOf("backup", "download", "json", "save", "snapshot", "configuration"),
            ),
            CatalogEntry(
                id = "backup.import",
                route = "/backup",
                section = "backup",
                title = Localized("search.entries.backup.import.title", "Import settings from JSON"),
                description =
                    Localized(
                        "search.entries.backup.import.desc",
                        "Restore alert rules, geofences, and quiet-hours windows from a previously exported bundle.",
                    ),
                keywords = listOf("restore", "upload", "json", "load", "recover", "configuration"),
            ),
            // ── Webhook channels ────────────────────────────────────────────
            CatalogEntry(
                id = "webhooks.list",
                route = "/notifications/webhooks",
                section = "webhooks",
                title = Localized("search.entries.webhooks.list.title", "Webhook channels"),
                description =
                    Localized(
                        "search.entries.webhooks.list.desc",
                        "Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver.",
                    ),
                keywords = listOf("webhook", "discord", "slack", "n8n", "home assistant", "http", "integration", "automation"),
            ),
            CatalogEntry(
                id = "webhooks.signing",
                route = "/notifications/webhooks",
                section = "webhooks",
                title = Localized("search.entries.webhooks.signing.title", "Webhook HMAC signing"),
                description =
                    Localized(
                        "search.entries.webhooks.signing.desc",
                        "Sign outbound webhooks with a shared secret so receivers can verify authenticity " +
                            "via the X-TeslaSync-Signature header.",
                    ),
                keywords = listOf("hmac", "sign", "signature", "sha256", "secret", "verify", "authenticity"),
            ),
            CatalogEntry(
                id = "webhooks.test",
                route = "/notifications/webhooks",
                section = "webhooks",
                title = Localized("search.entries.webhooks.test.title", "Test a webhook channel"),
                description =
                    Localized(
                        "search.entries.webhooks.test.desc",
                        "Fire a test event at a configured webhook to verify your receiver and signature pipeline.",
                    ),
                keywords = listOf("test", "fire", "verify", "debug", "try"),
            ),
            // ── Reset to defaults ───────────────────────────────────────────
            CatalogEntry(
                id = "reset.section",
                route = "/settings#reset",
                section = "reset",
                title = Localized("search.entries.reset.section.title", "Reset a section to defaults"),
                description =
                    Localized(
                        "search.entries.reset.section.desc",
                        "Wipe one section at a time — alert rules, geofences, channels, automations, dashboard layouts, " +
                            "quiet hours, or general/appearance preferences.",
                    ),
                keywords = listOf("reset", "defaults", "wipe", "clear", "restore", "factory", "erase"),
            ),
            CatalogEntry(
                id = "reset.all",
                route = "/settings#reset",
                section = "reset",
                title = Localized("search.entries.reset.all.title", "Reset ALL settings"),
                description =
                    Localized(
                        "search.entries.reset.all.desc",
                        "Danger zone — wipe every user-discoverable preference, alert rule, channel, geofence, automation, " +
                            "and dashboard layout in one transaction. Requires typing RESET to confirm.",
                    ),
                keywords = listOf("reset", "all", "danger", "wipe", "nuke", "factory", "erase", "fresh start"),
            ),
            // ── Helix (AI integration, lives on its own page) ───────────────
            CatalogEntry(
                id = "helix.integration",
                route = "/integrations/helix",
                section = "integrations",
                title = Localized("search.entries.helix.integration.title", "Helix (AI integration)"),
                description =
                    Localized(
                        "search.entries.helix.integration.desc",
                        "Optional AI integration — provider, API key, cost cap, and per-feature opt-in toggles. Off by default.",
                    ),
                keywords =
                    listOf(
                        "ai",
                        "helix",
                        "assistant",
                        "llm",
                        "gpt",
                        "openai",
                        "anthropic",
                        "chatbot",
                        "provider",
                        "cost cap",
                        "api key",
                        "model",
                    ),
            ),
        )
}

/**
 * The pure search + projection behind the SettingsSearch surface — a 1:1 port of the web `searchSettings`
 * and `fuzzyMatch` (searchIndex.ts) plus the `matches.slice(0, MAX_RESULTS)` cap and the idle/results/empty
 * branch the component renders. Holds no Compose/Android types so it runs in the off-device unit gate.
 */
object SettingsSearchProjection {
    /**
     * Projects the resolved [index] + the raw input [query] onto the render-ready dropdown state — the web
     * `showDropdown` gate plus `matches.slice(0, MAX_RESULTS)`. An empty raw query is
     * [SettingsSearchStatus.Idle] (web `query.length > 0` is false, so the dropdown is not shown); otherwise
     * the ranked matches are capped to [MAX_RESULTS] and the status is [SettingsSearchStatus.Results] when any
     * matched, else [SettingsSearchStatus.Empty] (the web "No matching settings." row). The idle gate is the
     * RAW length (not trimmed), exactly like the web, so a whitespace-only query still opens an empty dropdown.
     */
    fun project(
        index: List<SettingsSearchEntry>,
        query: String,
    ): SettingsSearchResults {
        if (query.isEmpty()) return SettingsSearchResults(SettingsSearchStatus.Idle)
        val matches = searchSettings(index, query).take(MAX_RESULTS)
        return if (matches.isEmpty()) {
            SettingsSearchResults(SettingsSearchStatus.Empty)
        } else {
            SettingsSearchResults(SettingsSearchStatus.Results, matches)
        }
    }

    /**
     * Scores and filters the [index] against [query] — a 1:1 port of the web `searchSettings`. Substring
     * matches on title/description/keywords rank above fuzzy-subsequence matches, and title hits beat
     * description hits within each tier; ties keep index order (Kotlin's sort is stable, like V8's). Returns
     * the matching entries pre-sorted by descending score; callers cap the list before rendering.
     */
    fun searchSettings(
        index: List<SettingsSearchEntry>,
        query: String,
    ): List<SettingsSearchEntry> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return emptyList()
        val scored = ArrayList<Pair<SettingsSearchEntry, Int>>()
        for (entry in index) {
            val title = entry.title.lowercase()
            val desc = entry.description.lowercase()
            val keywordHit = entry.keywords.any { it.lowercase().contains(q) }
            val score =
                when {
                    title == q -> SCORE_TITLE_EXACT
                    title.startsWith(q) -> SCORE_TITLE_PREFIX
                    title.contains(q) -> SCORE_TITLE_SUBSTRING
                    keywordHit -> SCORE_KEYWORD
                    desc.contains(q) -> SCORE_DESCRIPTION
                    fuzzyMatch(q, entry.title) -> SCORE_FUZZY_TITLE
                    fuzzyMatch(q, entry.description) -> SCORE_FUZZY_DESCRIPTION
                    else -> 0
                }
            if (score > 0) scored.add(entry to score)
        }
        return scored.sortedByDescending { it.second }.map { it.first }
    }

    /**
     * Case-insensitive subsequence match — a 1:1 port of the web `fuzzyMatch`. Returns true when every
     * character of [needle] appears in [haystack] in order (e.g. "lng" → "Language"). An empty needle never
     * matches (callers short-circuit on empty queries); an empty haystack only matches the empty needle.
     */
    fun fuzzyMatch(
        needle: String,
        haystack: String,
    ): Boolean {
        if (needle.isEmpty()) return false
        val haystackLower = haystack.lowercase()
        var cursor = 0
        // `all` short-circuits on the first miss, reproducing the web loop's early `return false`; the
        // captured cursor advances past each matched character in order (web `i = found + 1`).
        return needle.lowercase().all { ch ->
            val found = haystackLower.indexOf(ch, cursor)
            if (found < 0) {
                false
            } else {
                cursor = found + 1
                true
            }
        }
    }

    // Match-tier scores — the web `searchSettings` literals (substring > keyword > description > fuzzy;
    // title beats description within each tier). Named so the ranking reads as intent, not magic numbers.
    private const val SCORE_TITLE_EXACT = 1000
    private const val SCORE_TITLE_PREFIX = 800
    private const val SCORE_TITLE_SUBSTRING = 600
    private const val SCORE_KEYWORD = 400
    private const val SCORE_DESCRIPTION = 300
    private const val SCORE_FUZZY_TITLE = 200
    private const val SCORE_FUZZY_DESCRIPTION = 100
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the typed
 * query text or any matched setting route — so a diagnostics line can never leak what the user is searching
 * for or where they are navigating to.
 */
object SettingsSearchDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "settings-search"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SettingsSearch"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
