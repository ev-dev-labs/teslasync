//
//  SettingsSearch.Catalog.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  The settings search index — the faithful port of `getSettingsIndex(t)` in
//  features/settings/searchIndex.ts. Each entry maps a user-discoverable setting to its deep-link
//  `href`, its localized title + description (resolved through the injected P1/S10 localizer with the
//  web `t(key, default)` English fallback), its section, and its verbatim keyword synonyms (untranslated
//  in the web source). The catalog is Foundation-only so it builds + ranks headless in the test suite.
//  Section glyphs are a native enrichment (SF Symbols) over the web's text-only rows.
//
//  The index is a verbatim-text data table (the web English fallbacks are long), so this file opts out
//  of the line/file-length limits exactly like the sibling catalog files (e.g. WidgetPicker.Catalog).
//

import Foundation

// swiftlint:disable file_length line_length

/// The canonical list of indexed settings. The production source builds it through the P1/S10 facade
/// (`SettingsSearchStrings.string`); previews + tests build it with the fallback localizer. Mirrors the
/// web `getSettingsIndex(t)` entry-for-entry: same ids, hrefs, sections, titles, descriptions, keywords,
/// and order — so the native ranker resolves the identical result list for identical input.
public enum SettingsCatalog {
    /// Builds the index, resolving each title + description through `localize` (web `t(key, fallback)`).
    public static func entries(localize: (String, String) -> String) -> [SettingsEntry] {
        teslaAccount(localize)
            + regionAndApi(localize)
            + general(localize)
            + notifications(localize)
            + quietHours(localize)
            + appearance(localize)
            + security(localize)
            + privacy(localize)
            + advancedAndData(localize)
            + webhooks(localize)
            + reset(localize)
            + integrations(localize)
    }
}

// MARK: - Tesla account / region / features / orders

private extension SettingsCatalog {
    static func teslaAccount(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "tesla.connect", href: "/tesla-account", section: "tesla",
                title: t("search.entries.tesla.connect.title", "Connect Tesla account"),
                description: t(
                    "search.entries.tesla.connect.desc",
                    "Authorize TeslaSync to access your Tesla account."
                ),
                keywords: ["oauth", "login", "authorize", "sign in"], systemImage: "person.crop.circle.badge.plus"
            ),
            SettingsEntry(
                id: "tesla.refresh-token", href: "/tesla-account", section: "tesla",
                title: t("search.entries.tesla.refreshToken.title", "Tesla refresh token"),
                description: t(
                    "search.entries.tesla.refreshToken.desc",
                    "Manually refresh the cached Tesla OAuth token."
                ),
                keywords: ["oauth", "token", "auth"], systemImage: "arrow.triangle.2.circlepath"
            ),
            SettingsEntry(
                id: "tesla.disconnect", href: "/tesla-account", section: "tesla",
                title: t("search.entries.tesla.disconnect.title", "Disconnect Tesla account"),
                description: t("search.entries.tesla.disconnect.desc", "Sign out and remove the cached OAuth token."),
                keywords: ["logout", "sign out", "remove"], systemImage: "person.crop.circle.badge.xmark"
            ),
            SettingsEntry(
                id: "tesla.sync-vehicles", href: "/tesla-account", section: "tesla",
                title: t("search.entries.tesla.syncVehicles.title", "Sync vehicles from Tesla"),
                description: t(
                    "search.entries.tesla.syncVehicles.desc",
                    "Pull the current vehicle list from the Tesla Fleet API."
                ),
                keywords: ["vin", "cars", "fleet"], systemImage: "car.2.fill"
            )
        ]
    }

    static func regionAndApi(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "region.fleet-api", href: "/tesla-region", section: "region",
                title: t("search.entries.region.title", "Region & Fleet API endpoint"),
                description: t(
                    "search.entries.region.desc",
                    "Tesla account region and the resolved Fleet API base URL."
                ),
                keywords: ["country", "tld", "endpoint", "na", "eu"], systemImage: "globe"
            ),
            SettingsEntry(
                id: "features.flags", href: "/tesla-features", section: "features",
                title: t("search.entries.features.title", "Feature flags"),
                description: t(
                    "search.entries.features.desc",
                    "Tesla account feature configuration synced from the Fleet API."
                ),
                keywords: ["premium", "subscription", "config"], systemImage: "flag.fill"
            ),
            SettingsEntry(
                id: "orders.active", href: "/tesla-orders", section: "orders",
                title: t("search.entries.orders.title", "Active orders"),
                description: t("search.entries.orders.desc", "Vehicle orders and delivery tracking from Tesla."),
                keywords: ["delivery", "order", "reservation"], systemImage: "shippingbox.fill"
            )
        ]
    }

    static func general(_ t: (String, String) -> String) -> [SettingsEntry] {
        generalUnits(t) + generalLocale(t) + generalCost(t)
    }

    static func generalUnits(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "general.units.distance", href: "/settings#general", section: "general",
                title: t("search.entries.general.distance.title", "Distance unit"),
                description: t("search.entries.general.distance.desc", "Show distances in kilometers or miles."),
                keywords: ["km", "mi", "metric", "imperial"], systemImage: "ruler.fill"
            ),
            SettingsEntry(
                id: "general.units.temperature", href: "/settings#general", section: "general",
                title: t("search.entries.general.temperature.title", "Temperature unit"),
                description: t(
                    "search.entries.general.temperature.desc",
                    "Show temperatures in Celsius or Fahrenheit."
                ),
                keywords: ["celsius", "fahrenheit", "c", "f"], systemImage: "thermometer.medium"
            ),
            SettingsEntry(
                id: "general.units.pressure", href: "/settings#general", section: "general",
                title: t("search.entries.general.pressure.title", "Tire pressure unit"),
                description: t("search.entries.general.pressure.desc", "Show tire pressure in Bar or PSI."),
                keywords: ["psi", "bar", "tire", "tyre"], systemImage: "gauge.with.dots.needle.50percent"
            ),
            SettingsEntry(
                id: "general.range", href: "/settings#general", section: "general",
                title: t("search.entries.general.range.title", "Preferred range"),
                description: t("search.entries.general.range.desc", "Display rated or ideal range for the battery."),
                keywords: ["ideal", "rated", "epa"], systemImage: "battery.100"
            ),
            SettingsEntry(
                id: "general.precision", href: "/settings#general", section: "general",
                title: t("search.entries.general.precision.title", "Decimal precision"),
                description: t(
                    "search.entries.general.precision.desc",
                    "Number of decimal places shown on numeric metrics."
                ),
                keywords: ["decimals", "rounding", "sig figs"], systemImage: "number"
            )
        ]
    }

    static func generalLocale(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "general.language", href: "/settings#general", section: "general",
                title: t("search.entries.general.language.title", "Language"),
                description: t("search.entries.general.language.desc", "Application interface language."),
                keywords: ["locale", "translation", "i18n"], systemImage: "character.bubble"
            ),
            SettingsEntry(
                id: "general.currency", href: "/settings#general", section: "general",
                title: t("search.entries.general.currency.title", "Currency"),
                description: t(
                    "search.entries.general.currency.desc",
                    "Currency symbol used in cost and savings displays."
                ),
                keywords: ["usd", "eur", "gbp", "money"], systemImage: "dollarsign.circle"
            ),
            SettingsEntry(
                id: "general.locale", href: "/settings#general", section: "general",
                title: t("search.entries.general.locale.title", "Number & date locale"),
                description: t(
                    "search.entries.general.locale.desc",
                    "Locale used for number, date, and time formatting."
                ),
                keywords: ["format", "thousand separator", "comma"], systemImage: "textformat.123"
            ),
            SettingsEntry(
                id: "general.timezone", href: "/settings#general", section: "general",
                title: t("search.entries.general.timezone.title", "Time zone"),
                description: t(
                    "search.entries.general.timezone.desc",
                    "Whether timestamps follow the vehicle, your local time, or UTC."
                ),
                keywords: ["tz", "utc", "local", "iana"], systemImage: "clock.fill"
            )
        ]
    }

    static func generalCost(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "general.electricity-cost", href: "/settings#general", section: "general",
                title: t("search.entries.general.electricityCost.title", "Electricity cost (per kWh)"),
                description: t(
                    "search.entries.general.electricityCost.desc",
                    "Per-kWh price used in charging cost calculations."
                ),
                keywords: ["kwh", "price", "rate", "cost"], systemImage: "bolt.fill"
            ),
            SettingsEntry(
                id: "general.gas-price", href: "/settings#general", section: "general",
                title: t("search.entries.general.gasPriceManual.title", "Comparison gas price"),
                description: t(
                    "search.entries.general.gasPriceManual.desc",
                    "Manual gas price used in EV-vs-ICE savings comparisons."
                ),
                keywords: ["fuel", "gallon", "liter", "gasoline"], systemImage: "fuelpump.fill"
            ),
            SettingsEntry(
                id: "general.mpg", href: "/settings#general", section: "general",
                title: t("search.entries.general.mpg.title", "Comparison vehicle MPG"),
                description: t(
                    "search.entries.general.mpg.desc",
                    "Average MPG of the equivalent gas car for savings calculations."
                ),
                keywords: ["fuel economy", "efficiency", "mpg"], systemImage: "speedometer"
            ),
            SettingsEntry(
                id: "gas-price.auto-poll", href: "/gas-price", section: "gas-price",
                title: t("search.entries.gasPrice.title", "Gas price auto-poll"),
                description: t("search.entries.gasPrice.desc", "Automatically fetch US average gas prices from EIA."),
                keywords: ["eia", "fuel", "poll", "auto"], systemImage: "fuelpump.circle.fill"
            )
        ]
    }
}

// MARK: - Notifications / quiet hours / appearance

private extension SettingsCatalog {
    static func notifications(_ t: (String, String) -> String) -> [SettingsEntry] {
        notificationsBrowser(t) + notificationsSound(t)
    }

    static func notificationsBrowser(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "notifications.browser-permission", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.browser.title", "Browser notifications"),
                description: t(
                    "search.entries.notifications.browser.desc",
                    "Enable browser notifications when the tab is in the background."
                ),
                keywords: ["push", "permission", "desktop"], systemImage: "bell.badge.fill"
            ),
            SettingsEntry(
                id: "notifications.alerts", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.alerts.title", "Alert notifications"),
                description: t("search.entries.notifications.alerts.desc", "Get notified when an alert rule fires."),
                keywords: ["rules", "alarm", "warning"], systemImage: "bell.fill"
            ),
            SettingsEntry(
                id: "notifications.export-status", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.exportStatus.title", "Export completion notifications"),
                description: t(
                    "search.entries.notifications.exportStatus.desc",
                    "Get notified when a CSV/JSON export finishes."
                ),
                keywords: ["export", "download", "csv", "json"], systemImage: "square.and.arrow.down"
            ),
            SettingsEntry(
                id: "notifications.tab-badge", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.tabBadge.title", "Browser tab unread badge"),
                description: t(
                    "search.entries.notifications.tabBadge.desc",
                    "Show unread count in the browser tab title and favicon."
                ),
                keywords: ["favicon", "count", "tab"], systemImage: "app.badge.fill"
            )
        ]
    }

    static func notificationsSound(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "notifications.critical-flash", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.criticalFlash.title", "Critical alert tab flash"),
                description: t(
                    "search.entries.notifications.criticalFlash.desc",
                    "Flash the browser tab title on critical alerts."
                ),
                keywords: ["flash", "urgent", "tab"], systemImage: "exclamationmark.triangle.fill"
            ),
            SettingsEntry(
                id: "notifications.sound-master", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.soundMaster.title", "Notification sounds"),
                description: t(
                    "search.entries.notifications.soundMaster.desc",
                    "Play short audio cues when alerts and completion events arrive."
                ),
                keywords: ["audio", "sound", "chime", "beep", "noise", "mute", "volume"],
                systemImage: "speaker.wave.2.fill"
            ),
            SettingsEntry(
                id: "notifications.sound-channels", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.soundChannels.title", "Per-channel notification sounds"),
                description: t(
                    "search.entries.notifications.soundChannels.desc",
                    "Toggle sound separately for critical, warning, and info alerts plus charge/drive/automation completions."
                ),
                keywords: ["critical", "warning", "info", "channel", "category", "audio", "cue"],
                systemImage: "slider.horizontal.below.square.and.square.filled"
            ),
            SettingsEntry(
                id: "notifications.sound-volume", href: "/notifications/browser", section: "notifications",
                title: t("search.entries.notifications.soundVolume.title", "Notification sound volume"),
                description: t(
                    "search.entries.notifications.soundVolume.desc",
                    "Adjust how loud notification cues play."
                ),
                keywords: ["volume", "loud", "quiet", "audio", "level"], systemImage: "speaker.wave.3.fill"
            )
        ]
    }

    static func quietHours(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "quiet-hours.windows", href: "/notifications/quiet-hours", section: "quiet-hours",
                title: t("search.entries.quietHours.windows.title", "Quiet hours windows"),
                description: t(
                    "search.entries.quietHours.windows.desc",
                    "Defer non-critical notifications during sleep, work meetings, or any time-of-day window."
                ),
                keywords: ["dnd", "do not disturb", "sleep", "mute", "silence", "night"], systemImage: "moon.fill"
            ),
            SettingsEntry(
                id: "quiet-hours.bypass-severities", href: "/notifications/quiet-hours", section: "quiet-hours",
                title: t("search.entries.quietHours.bypass.title", "Quiet hours bypass severities"),
                description: t(
                    "search.entries.quietHours.bypass.desc",
                    "Choose which severities (e.g. critical) still ring through during quiet hours."
                ),
                keywords: ["critical", "override", "bypass", "severity"],
                systemImage: "bell.and.waves.left.and.right.fill"
            ),
            SettingsEntry(
                id: "quiet-hours.timezone", href: "/notifications/quiet-hours", section: "quiet-hours",
                title: t("search.entries.quietHours.timezone.title", "Quiet hours timezone"),
                description: t(
                    "search.entries.quietHours.timezone.desc",
                    "Pick the IANA timezone the start/end times are evaluated against."
                ),
                keywords: ["tz", "timezone", "iana", "utc"], systemImage: "globe.badge.chevron.backward"
            )
        ]
    }

    static func appearance(_ t: (String, String) -> String) -> [SettingsEntry] {
        appearanceTheme(t) + appearanceExtras(t)
    }

    static func appearanceTheme(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "appearance.theme", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.theme.title", "Theme"),
                description: t(
                    "search.entries.appearance.theme.desc",
                    "Choose light, dark, or system mode and pick an accent color."
                ),
                keywords: ["dark", "light", "color", "accent", "mode"], systemImage: "paintbrush.fill"
            ),
            SettingsEntry(
                id: "appearance.density", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.density.title", "Information density"),
                description: t(
                    "search.entries.appearance.density.desc",
                    "Compact, comfortable, or spacious row sizing across tables and cards."
                ),
                keywords: ["compact", "comfortable", "spacious", "rows", "spacing"],
                systemImage: "rectangle.compress.vertical"
            ),
            SettingsEntry(
                id: "appearance.timeFormat", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.timeFormat.title", "Default time format"),
                description: t(
                    "search.entries.appearance.timeFormat.desc",
                    "Show timestamps as relative (\"2h ago\") or absolute (\"Nov 12, 13:42\")."
                ),
                keywords: ["relative", "absolute", "timestamp", "date", "time"], systemImage: "clock.arrow.circlepath"
            )
        ]
    }

    static func appearanceExtras(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "appearance.chartPalette", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.chartPalette.title", "Chart palette"),
                description: t(
                    "search.entries.appearance.chartPalette.desc",
                    "Color-blind safe (Okabe-Ito) or stylistic neon chart colors."
                ),
                keywords: ["cb", "colorblind", "okabe", "neon", "colors"], systemImage: "chart.bar.xaxis"
            ),
            SettingsEntry(
                id: "appearance.statusBar", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.statusBar.title", "Status bar"),
                description: t(
                    "search.entries.appearance.statusBar.desc",
                    "Show or hide the always-on footer status bar."
                ),
                keywords: ["footer", "health", "bar"], systemImage: "menubar.rectangle"
            ),
            SettingsEntry(
                id: "appearance.celebrations", href: "/settings#appearance", section: "appearance",
                title: t("search.entries.appearance.celebrations.title", "Achievement celebrations"),
                description: t(
                    "search.entries.appearance.celebrations.desc",
                    "Celebration toasts and sound when an achievement unlocks."
                ),
                keywords: ["confetti", "sound", "achievement", "unlock"], systemImage: "sparkles"
            )
        ]
    }
}

// MARK: - Security / privacy / advanced + data

private extension SettingsCatalog {
    static func security(_ t: (String, String) -> String) -> [SettingsEntry] {
        securityTotp(t) + securitySessions(t)
    }

    static func securityTotp(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "security.totp.enroll", href: "/account/2fa", section: "security",
                title: t("search.entries.security.totpEnroll.title", "Enable two-factor authentication"),
                description: t(
                    "search.entries.security.totpEnroll.desc",
                    "Set up TOTP from your authenticator app to protect destructive admin actions."
                ),
                keywords: ["totp", "2fa", "mfa", "authenticator", "security", "sudo", "step-up"],
                systemImage: "lock.shield.fill"
            ),
            SettingsEntry(
                id: "security.totp.backupCodes", href: "/account/2fa", section: "security",
                title: t("search.entries.security.totpBackupCodes.title", "TOTP backup codes"),
                description: t(
                    "search.entries.security.totpBackupCodes.desc",
                    "Regenerate or download the backup codes used when you lose access to your authenticator."
                ),
                keywords: ["backup", "recovery", "codes", "totp", "2fa"], systemImage: "key.horizontal.fill"
            ),
            SettingsEntry(
                id: "security.totp.disable", href: "/account/2fa", section: "security",
                title: t("search.entries.security.totpDisable.title", "Disable two-factor authentication"),
                description: t(
                    "search.entries.security.totpDisable.desc",
                    "Remove the TOTP credential and revoke all backup codes for the current subject."
                ),
                keywords: ["disable", "remove", "totp", "2fa", "unenroll"], systemImage: "lock.open.fill"
            )
        ]
    }

    static func securitySessions(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "security.sessions.list", href: "/account/sessions", section: "security",
                title: t("search.entries.security.sessionsList.title", "Active sessions"),
                description: t(
                    "search.entries.security.sessionsList.desc",
                    "See which browsers and devices are currently signed in to TeslaSync and revoke individual sessions."
                ),
                keywords: ["session", "device", "browser", "sign out", "logout", "revoke", "cookie"],
                systemImage: "laptopcomputer.and.iphone"
            ),
            SettingsEntry(
                id: "security.sessions.revokeAll", href: "/account/sessions", section: "security",
                title: t("search.entries.security.sessionsRevokeAll.title", "Sign out all other devices"),
                description: t(
                    "search.entries.security.sessionsRevokeAll.desc",
                    "Revoke every TeslaSync session except the current browser. Useful after a lost laptop or shared computer."
                ),
                keywords: ["logout", "revoke", "session", "everywhere", "all devices", "security"],
                systemImage: "xmark.shield.fill"
            )
        ]
    }

    static func privacy(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "privacy.recentPages.clear", href: "/account/privacy", section: "privacy",
                title: t("search.entries.privacy.recentPagesClear.title", "Clear recently viewed pages"),
                description: t(
                    "search.entries.privacy.recentPagesClear.desc",
                    "Wipe the local list of pages used by the dashboard widget and the Recent section in the command palette."
                ),
                keywords: ["recent", "history", "clear", "wipe", "pages", "palette", "dashboard"],
                systemImage: "clock.badge.xmark"
            ),
            SettingsEntry(
                id: "privacy.consent.manage", href: "/account/privacy", section: "privacy",
                title: t("search.entries.privacy.consentManage.title", "Cookies & analytics consent"),
                description: t(
                    "search.entries.privacy.consentManage.desc",
                    "Re-grant, withdraw, or reset the cookie / analytics consent banner state for this browser."
                ),
                keywords: ["cookies", "consent", "gdpr", "analytics", "tracking", "banner", "opt-in", "opt-out"],
                systemImage: "hand.raised.fill"
            )
        ]
    }

    static func advancedAndData(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "advanced.restoreConfirms", href: "/settings#advanced", section: "advanced",
                title: t("search.entries.advanced.restoreConfirms.title", "Restore confirmation prompts"),
                description: t(
                    "search.entries.advanced.restoreConfirms.desc",
                    "Re-enable “Don’t ask again” prompts you previously silenced."
                ),
                keywords: ["confirm", "dialog", "silence", "dont ask", "reset", "restore"],
                systemImage: "checkmark.bubble.fill"
            ),
            SettingsEntry(
                id: "backup.export", href: "/backup", section: "backup",
                title: t("search.entries.backup.export.title", "Export settings as JSON"),
                description: t(
                    "search.entries.backup.export.desc",
                    "Download a portable bundle of general settings, alert rules, geofences, and quiet-hours windows."
                ),
                keywords: ["backup", "download", "json", "save", "snapshot", "configuration"],
                systemImage: "externaldrive.fill.badge.timemachine"
            ),
            SettingsEntry(
                id: "backup.import", href: "/backup", section: "backup",
                title: t("search.entries.backup.import.title", "Import settings from JSON"),
                description: t(
                    "search.entries.backup.import.desc",
                    "Restore alert rules, geofences, and quiet-hours windows from a previously exported bundle."
                ),
                keywords: ["restore", "upload", "json", "load", "recover", "configuration"],
                systemImage: "square.and.arrow.up.on.square.fill"
            )
        ]
    }
}

// MARK: - Webhooks / reset / integrations

private extension SettingsCatalog {
    static func webhooks(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "webhooks.list", href: "/notifications/webhooks", section: "webhooks",
                title: t("search.entries.webhooks.list.title", "Webhook channels"),
                description: t(
                    "search.entries.webhooks.list.desc",
                    "Forward TeslaSync notifications to Discord, Slack, n8n, Home Assistant, or any HTTP receiver."
                ),
                keywords: ["webhook", "discord", "slack", "n8n", "home assistant", "http", "integration", "automation"],
                systemImage: "link"
            ),
            SettingsEntry(
                id: "webhooks.signing", href: "/notifications/webhooks", section: "webhooks",
                title: t("search.entries.webhooks.signing.title", "Webhook HMAC signing"),
                description: t(
                    "search.entries.webhooks.signing.desc",
                    "Sign outbound webhooks with a shared secret so receivers can verify authenticity via the X-TeslaSync-Signature header."
                ),
                keywords: ["hmac", "sign", "signature", "sha256", "secret", "verify", "authenticity"],
                systemImage: "signature"
            ),
            SettingsEntry(
                id: "webhooks.test", href: "/notifications/webhooks", section: "webhooks",
                title: t("search.entries.webhooks.test.title", "Test a webhook channel"),
                description: t(
                    "search.entries.webhooks.test.desc",
                    "Fire a test event at a configured webhook to verify your receiver and signature pipeline."
                ),
                keywords: ["test", "fire", "verify", "debug", "try"], systemImage: "paperplane.fill"
            )
        ]
    }

    static func reset(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "reset.section", href: "/settings#reset", section: "reset",
                title: t("search.entries.reset.section.title", "Reset a section to defaults"),
                description: t(
                    "search.entries.reset.section.desc",
                    "Wipe one section at a time — alert rules, geofences, channels, automations, dashboard layouts, quiet hours, or general/appearance preferences."
                ),
                keywords: ["reset", "defaults", "wipe", "clear", "restore", "factory", "erase"],
                systemImage: "arrow.counterclockwise"
            ),
            SettingsEntry(
                id: "reset.all", href: "/settings#reset", section: "reset",
                title: t("search.entries.reset.all.title", "Reset ALL settings"),
                description: t(
                    "search.entries.reset.all.desc",
                    "Danger zone — wipe every user-discoverable preference, alert rule, channel, geofence, automation, and dashboard layout in one transaction. Requires typing RESET to confirm."
                ),
                keywords: ["reset", "all", "danger", "wipe", "nuke", "factory", "erase", "fresh start"],
                systemImage: "trash.fill"
            )
        ]
    }

    static func integrations(_ t: (String, String) -> String) -> [SettingsEntry] {
        [
            SettingsEntry(
                id: "helix.integration", href: "/integrations/helix", section: "integrations",
                title: t("search.entries.helix.integration.title", "Helix (AI integration)"),
                description: t(
                    "search.entries.helix.integration.desc",
                    "Optional AI integration — provider, API key, cost cap, and per-feature opt-in toggles. Off by default."
                ),
                keywords: [
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
                    "model"
                ],
                systemImage: "sparkles"
            )
        ]
    }
}

// swiftlint:enable file_length line_length
