using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SettingsSearchViewModel"/> binds to (P1/S8 state-holder seam). It builds the
/// canonical settings find-as-you-type index the web component composes through
/// <c>getSettingsIndex(t)</c> (web/src/features/settings/searchIndex.ts). The view never builds the index
/// itself; the concrete <see cref="SettingsIndexSource"/> (or a test fake) drives this.
/// </summary>
public interface ISettingsIndexSource
{
    /// <summary>
    /// Build the ordered list of indexed settings, resolving every title / description through the i18n
    /// facade (web <c>getSettingsIndex</c> with the <c>useTranslation('settings')</c> <c>t</c>).
    /// </summary>
    IReadOnlyList<SettingsEntry> BuildIndex();
}

/// <summary>
/// The localizer-backed <see cref="ISettingsIndexSource"/> — a verbatim native port of
/// <c>getSettingsIndex</c> (web/src/features/settings/searchIndex.ts). Each entry maps a stable id to its
/// target href (a <c>/settings</c> hash anchor or a promoted cross-page route), with the title, description
/// and synonym keywords drawn from the web source one-for-one; titles and descriptions resolve through the
/// P1/S10 facade using the same <c>search.entries.*</c> keys the web passes to <c>t</c> (all present in the
/// en catalog), falling back to the verbatim English copy. No WinUI types — unit-tested headlessly.
/// </summary>
public sealed class SettingsIndexSource : ISettingsIndexSource
{
    private readonly ILocalizer _localizer;

    /// <summary>Creates the source over the i18n facade the entries resolve through.</summary>
    public SettingsIndexSource(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
    }

    /// <inheritdoc />
    public IReadOnlyList<SettingsEntry> BuildIndex()
    {
        ILocalizer t = _localizer;
        return
        [
            // ── Tesla account ───────────────────────────────────────────────
            Entry(
                t, "tesla.connect", "/tesla-account", "tesla",
                "search.entries.tesla.connect.title", "Connect Tesla account",
                "search.entries.tesla.connect.desc", "Authorize TeslaSync to access your Tesla account.",
                "oauth", "login", "authorize", "sign in"),
            Entry(
                t, "tesla.refresh-token", "/tesla-account", "tesla",
                "search.entries.tesla.refreshToken.title", "Tesla refresh token",
                "search.entries.tesla.refreshToken.desc", "Manually refresh the cached Tesla OAuth token.",
                "oauth", "token", "auth"),
            Entry(
                t, "tesla.disconnect", "/tesla-account", "tesla",
                "search.entries.tesla.disconnect.title", "Disconnect Tesla account",
                "search.entries.tesla.disconnect.desc", "Sign out and remove the cached OAuth token.",
                "logout", "sign out", "remove"),
            Entry(
                t, "tesla.sync-vehicles", "/tesla-account", "tesla",
                "search.entries.tesla.syncVehicles.title", "Sync vehicles from Tesla",
                "search.entries.tesla.syncVehicles.desc", "Pull the current vehicle list from the Tesla Fleet API.",
                "vin", "cars", "fleet"),

            // ── Region & API ────────────────────────────────────────────────
            Entry(
                t, "region.fleet-api", "/tesla-region", "region",
                "search.entries.region.title", "Region & Fleet API endpoint",
                "search.entries.region.desc", "Tesla account region and the resolved Fleet API base URL.",
                "country", "tld", "endpoint", "na", "eu"),

            // ── Feature flags ───────────────────────────────────────────────
            Entry(
                t, "features.flags", "/tesla-features", "features",
                "search.entries.features.title", "Feature flags",
                "search.entries.features.desc", "Tesla account feature configuration synced from the Fleet API.",
                "premium", "subscription", "config"),

            // ── Active orders ───────────────────────────────────────────────
            Entry(
                t, "orders.active", "/tesla-orders", "orders",
                "search.entries.orders.title", "Active orders",
                "search.entries.orders.desc", "Vehicle orders and delivery tracking from Tesla.",
                "delivery", "order", "reservation"),

            // ── General — units & cost ──────────────────────────────────────
            Entry(
                t, "general.units.distance", "/settings#general", "general",
                "search.entries.general.distance.title", "Distance unit",
                "search.entries.general.distance.desc", "Show distances in kilometers or miles.",
                "km", "mi", "metric", "imperial"),
            Entry(
                t, "general.units.temperature", "/settings#general", "general",
                "search.entries.general.temperature.title", "Temperature unit",
                "search.entries.general.temperature.desc", "Show temperatures in Celsius or Fahrenheit.",
                "celsius", "fahrenheit", "c", "f"),
            Entry(
                t, "general.units.pressure", "/settings#general", "general",
                "search.entries.general.pressure.title", "Tire pressure unit",
                "search.entries.general.pressure.desc", "Show tire pressure in Bar or PSI.",
                "psi", "bar", "tire", "tyre"),
            Entry(
                t, "general.range", "/settings#general", "general",
                "search.entries.general.range.title", "Preferred range",
                "search.entries.general.range.desc", "Display rated or ideal range for the battery.",
                "ideal", "rated", "epa"),
            Entry(
                t, "general.precision", "/settings#general", "general",
                "search.entries.general.precision.title", "Decimal precision",
                "search.entries.general.precision.desc", "Number of decimal places shown on numeric metrics.",
                "decimals", "rounding", "sig figs"),
            Entry(
                t, "general.language", "/settings#general", "general",
                "search.entries.general.language.title", "Language",
                "search.entries.general.language.desc", "Application interface language.",
                "locale", "translation", "i18n"),
            Entry(
                t, "general.currency", "/settings#general", "general",
                "search.entries.general.currency.title", "Currency",
                "search.entries.general.currency.desc", "Currency symbol used in cost and savings displays.",
                "usd", "eur", "gbp", "money"),
            Entry(
                t, "general.locale", "/settings#general", "general",
                "search.entries.general.locale.title", "Number & date locale",
                "search.entries.general.locale.desc", "Locale used for number, date, and time formatting.",
                "format", "thousand separator", "comma"),
            Entry(
                t, "general.timezone", "/settings#general", "general",
                "search.entries.general.timezone.title", "Time zone",
                "search.entries.general.timezone.desc", "Whether timestamps follow the vehicle, your local time, or UTC.",
                "tz", "utc", "local", "iana"),
            Entry(
                t, "general.electricity-cost", "/settings#general", "general",
                "search.entries.general.electricityCost.title", "Electricity cost (per kWh)",
                "search.entries.general.electricityCost.desc", "Per-kWh price used in charging cost calculations.",
                "kwh", "price", "rate", "cost"),
            Entry(
                t, "general.gas-price", "/settings#general", "general",
                "search.entries.general.gasPriceManual.title", "Comparison gas price",
                "search.entries.general.gasPriceManual.desc", "Manual gas price used in EV-vs-ICE savings comparisons.",
                "fuel", "gallon", "liter", "gasoline"),
            Entry(
                t, "general.mpg", "/settings#general", "general",
                "search.entries.general.mpg.title", "Comparison vehicle MPG",
                "search.entries.general.mpg.desc", "Average MPG of the equivalent gas car for savings calculations.",
                "fuel economy", "efficiency", "mpg"),

            // ── Gas price auto-poll ─────────────────────────────────────────
            Entry(
                t, "gas-price.auto-poll", "/gas-price", "gas-price",
                "search.entries.gasPrice.title", "Gas price auto-poll",
                "search.entries.gasPrice.desc", "Automatically fetch US average gas prices from EIA.",
                "eia", "fuel", "poll", "auto"),

            // ── Notifications ───────────────────────────────────────────────
            Entry(
                t, "notifications.browser-permission", "/notifications/browser", "notifications",
                "search.entries.notifications.browser.title", "Browser notifications",
                "search.entries.notifications.browser.desc", "Enable browser notifications when the tab is in the background.",
                "push", "permission", "desktop"),
            Entry(
                t, "notifications.alerts", "/notifications/browser", "notifications",
                "search.entries.notifications.alerts.title", "Alert notifications",
                "search.entries.notifications.alerts.desc", "Get notified when an alert rule fires.",
                "rules", "alarm", "warning"),
            Entry(
                t, "notifications.export-status", "/notifications/browser", "notifications",
                "search.entries.notifications.exportStatus.title", "Export completion notifications",
                "search.entries.notifications.exportStatus.desc", "Get notified when a CSV/JSON export finishes.",
                "export", "download", "csv", "json"),
            Entry(
                t, "notifications.tab-badge", "/notifications/browser", "notifications",
                "search.entries.notifications.tabBadge.title", "Browser tab unread badge",
                "search.entries.notifications.tabBadge.desc", "Show unread count in the browser tab title and favicon.",
                "favicon", "count", "tab"),
            Entry(
                t, "notifications.critical-flash", "/notifications/browser", "notifications",
                "search.entries.notifications.criticalFlash.title", "Critical alert tab flash",
                "search.entries.notifications.criticalFlash.desc", "Flash the browser tab title on critical alerts.",
                "flash", "urgent", "tab"),
            Entry(
                t, "notifications.sound-master", "/notifications/browser", "notifications",
                "search.entries.notifications.soundMaster.title", "Notification sounds",
                "search.entries.notifications.soundMaster.desc", "Play short audio cues when alerts and completion events arrive.",
                "audio", "sound", "chime", "beep", "noise", "mute", "volume"),
            Entry(
                t, "notifications.sound-channels", "/notifications/browser", "notifications",
                "search.entries.notifications.soundChannels.title", "Per-channel notification sounds",
                "search.entries.notifications.soundChannels.desc", "Toggle sound separately for critical, warning, and info alerts plus charge/drive/automation completions.",
                "critical", "warning", "info", "channel", "category", "audio", "cue"),
            Entry(
                t, "notifications.sound-volume", "/notifications/browser", "notifications",
                "search.entries.notifications.soundVolume.title", "Notification sound volume",
                "search.entries.notifications.soundVolume.desc", "Adjust how loud notification cues play.",
                "volume", "loud", "quiet", "audio", "level"),

            // ── Quiet hours / Do-Not-Disturb ────────────────────────────────
            Entry(
                t, "quiet-hours.windows", "/notifications/quiet-hours", "quiet-hours",
                "search.entries.quietHours.windows.title", "Quiet hours windows",
                "search.entries.quietHours.windows.desc", "Defer non-critical notifications during sleep, work meetings, or any time-of-day window.",
                "dnd", "do not disturb", "sleep", "mute", "silence", "night"),
            Entry(
                t, "quiet-hours.bypass-severities", "/notifications/quiet-hours", "quiet-hours",
                "search.entries.quietHours.bypass.title", "Quiet hours bypass severities",
                "search.entries.quietHours.bypass.desc", "Choose which severities (e.g. critical) still ring through during quiet hours.",
                "critical", "override", "bypass", "severity"),
            Entry(
                t, "quiet-hours.timezone", "/notifications/quiet-hours", "quiet-hours",
                "search.entries.quietHours.timezone.title", "Quiet hours timezone",
                "search.entries.quietHours.timezone.desc", "Pick the IANA timezone the start/end times are evaluated against.",
                "tz", "timezone", "iana", "utc"),

            // ── Appearance ──────────────────────────────────────────────────
            Entry(
                t, "appearance.theme", "/settings#appearance", "appearance",
                "search.entries.appearance.theme.title", "Theme",
                "search.entries.appearance.theme.desc", "Choose light, dark, or system mode and pick an accent color.",
                "dark", "light", "color", "accent", "mode"),
            Entry(
                t, "appearance.density", "/settings#appearance", "appearance",
                "search.entries.appearance.density.title", "Information density",
                "search.entries.appearance.density.desc", "Compact, comfortable, or spacious row sizing across tables and cards.",
                "compact", "comfortable", "spacious", "rows", "spacing"),
            Entry(
                t, "appearance.timeFormat", "/settings#appearance", "appearance",
                "search.entries.appearance.timeFormat.title", "Default time format",
                "search.entries.appearance.timeFormat.desc", "Show timestamps as relative (\"2h ago\") or absolute (\"Nov 12, 13:42\").",
                "relative", "absolute", "timestamp", "date", "time"),
            Entry(
                t, "appearance.chartPalette", "/settings#appearance", "appearance",
                "search.entries.appearance.chartPalette.title", "Chart palette",
                "search.entries.appearance.chartPalette.desc", "Color-blind safe (Okabe-Ito) or stylistic neon chart colors.",
                "cb", "colorblind", "okabe", "neon", "colors"),
            Entry(
                t, "appearance.statusBar", "/settings#appearance", "appearance",
                "search.entries.appearance.statusBar.title", "Status bar",
                "search.entries.appearance.statusBar.desc", "Show or hide the always-on footer status bar.",
                "footer", "health", "bar"),
            Entry(
                t, "appearance.celebrations", "/settings#appearance", "appearance",
                "search.entries.appearance.celebrations.title", "Achievement celebrations",
                "search.entries.appearance.celebrations.desc", "Celebration toasts and sound when an achievement unlocks.",
                "confetti", "sound", "achievement", "unlock"),

            // ── Security (TOTP) ─────────────────────────────────────────────
            Entry(
                t, "security.totp.enroll", "/account/2fa", "security",
                "search.entries.security.totpEnroll.title", "Enable two-factor authentication",
                "search.entries.security.totpEnroll.desc", "Set up TOTP from your authenticator app to protect destructive admin actions.",
                "totp", "2fa", "mfa", "authenticator", "security", "sudo", "step-up"),
            Entry(
                t, "security.totp.backupCodes", "/account/2fa", "security",
                "search.entries.security.totpBackupCodes.title", "TOTP backup codes",
                "search.entries.security.totpBackupCodes.desc", "Regenerate or download the backup codes used when you lose access to your authenticator.",
                "backup", "recovery", "codes", "totp", "2fa"),
            Entry(
                t, "security.totp.disable", "/account/2fa", "security",
                "search.entries.security.totpDisable.title", "Disable two-factor authentication",
                "search.entries.security.totpDisable.desc", "Remove the TOTP credential and revoke all backup codes for the current subject.",
                "disable", "remove", "totp", "2fa", "unenroll"),
            Entry(
                t, "security.sessions.list", "/account/sessions", "security",
                "search.entries.security.sessionsList.title", "Active sessions",
                "search.entries.security.sessionsList.desc", "See which browsers and devices are currently signed in to TeslaSync and revoke individual sessions.",
                "session", "device", "browser", "sign out", "logout", "revoke", "cookie"),
            Entry(
                t, "security.sessions.revokeAll", "/account/sessions", "security",
                "search.entries.security.sessionsRevokeAll.title", "Sign out all other devices",
                "search.entries.security.sessionsRevokeAll.desc", "Revoke every TeslaSync session except the current browser. Useful after a lost laptop or shared computer.",
                "logout", "revoke", "session", "everywhere", "all devices", "security"),

            // ── Privacy (browser-local data) ────────────────────────────────
            Entry(
                t, "privacy.recentPages.clear", "/account/privacy", "privacy",
                "search.entries.privacy.recentPagesClear.title", "Clear recently viewed pages",
                "search.entries.privacy.recentPagesClear.desc", "Wipe the local list of pages used by the dashboard widget and the Recent section in the command palette.",
                "recent", "history", "clear", "wipe", "pages", "palette", "dashboard"),
            Entry(
                t, "privacy.consent.manage", "/account/privacy", "privacy",
                "search.entries.privacy.consentManage.title", "Cookies & analytics consent",
                "search.entries.privacy.consentManage.desc", "Re-grant, withdraw, or reset the cookie / analytics consent banner state for this browser.",
                "cookies", "consent", "gdpr", "analytics", "tracking", "banner", "opt-in", "opt-out"),

            // ── Advanced ────────────────────────────────────────────────────
            Entry(
                t, "advanced.restoreConfirms", "/settings#advanced", "advanced",
                "search.entries.advanced.restoreConfirms.title", "Restore confirmation prompts",
                "search.entries.advanced.restoreConfirms.desc", "Re-enable \u201CDon\u2019t ask again\u201D prompts you previously silenced.",
                "confirm", "dialog", "silence", "dont ask", "reset", "restore"),

            // ── Backup & Restore — dedicated /backup page ───────────────────
            Entry(
                t, "backup.export", "/backup", "backup",
                "search.entries.backup.export.title", "Export settings as JSON",
                "search.entries.backup.export.desc", "Download a portable bundle of general settings, alert rules, geofences, and quiet-hours windows.",
                "backup", "download", "json", "save", "snapshot", "configuration"),
            Entry(
                t, "backup.import", "/backup", "backup",
                "search.entries.backup.import.title", "Import settings from JSON",
                "search.entries.backup.import.desc", "Restore alert rules, geofences, and quiet-hours windows from a previously exported bundle.",
                "restore", "upload", "json", "load", "recover", "configuration"),

            // ── Webhook channels ────────────────────────────────────────────
            Entry(
                t, "webhooks.list", "/notifications/webhooks", "webhooks",
                "search.entries.webhooks.list.title", "Webhook channels",
                "search.entries.webhooks.list.desc", "Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver.",
                "webhook", "discord", "slack", "n8n", "home assistant", "http", "integration", "automation"),
            Entry(
                t, "webhooks.signing", "/notifications/webhooks", "webhooks",
                "search.entries.webhooks.signing.title", "Webhook HMAC signing",
                "search.entries.webhooks.signing.desc", "Sign outbound webhooks with a shared secret so receivers can verify authenticity via the X-TeslaSync-Signature header.",
                "hmac", "sign", "signature", "sha256", "secret", "verify", "authenticity"),
            Entry(
                t, "webhooks.test", "/notifications/webhooks", "webhooks",
                "search.entries.webhooks.test.title", "Test a webhook channel",
                "search.entries.webhooks.test.desc", "Fire a test event at a configured webhook to verify your receiver and signature pipeline.",
                "test", "fire", "verify", "debug", "try"),

            // ── Reset to defaults ───────────────────────────────────────────
            Entry(
                t, "reset.section", "/settings#reset", "reset",
                "search.entries.reset.section.title", "Reset a section to defaults",
                "search.entries.reset.section.desc", "Wipe one section at a time \u2014 alert rules, geofences, channels, automations, dashboard layouts, quiet hours, or general/appearance preferences.",
                "reset", "defaults", "wipe", "clear", "restore", "factory", "erase"),
            Entry(
                t, "reset.all", "/settings#reset", "reset",
                "search.entries.reset.all.title", "Reset ALL settings",
                "search.entries.reset.all.desc", "Danger zone \u2014 wipe every user-discoverable preference, alert rule, channel, geofence, automation, and dashboard layout in one transaction. Requires typing RESET to confirm.",
                "reset", "all", "danger", "wipe", "nuke", "factory", "erase", "fresh start"),

            // ── Helix (AI integration, lives on its own page) ───────────────
            Entry(
                t, "helix.integration", "/integrations/helix", "integrations",
                "search.entries.helix.integration.title", "Helix (AI integration)",
                "search.entries.helix.integration.desc", "Optional AI integration \u2014 provider, API key, cost cap, and per-feature opt-in toggles. Off by default.",
                "ai", "helix", "assistant", "llm", "gpt", "openai", "anthropic", "chatbot", "provider", "cost cap", "api key", "model"),
        ];
    }

    private static SettingsEntry Entry(
        ILocalizer localizer,
        string id,
        string href,
        string section,
        string titleKey,
        string titleFallback,
        string descriptionKey,
        string descriptionFallback,
        params string[] keywords) =>
        new(
            id,
            href,
            section,
            localizer.GetString(titleKey, titleFallback),
            localizer.GetString(descriptionKey, descriptionFallback),
            keywords);
}
