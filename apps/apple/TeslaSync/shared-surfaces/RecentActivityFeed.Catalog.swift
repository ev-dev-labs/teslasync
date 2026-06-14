//
//  RecentActivityFeed.Catalog.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  The action → visual catalog for the RecentActivityFeed surface — the SwiftUI parity of
//  `lib/activityIcons.ts`. Maps the `audit_logs.action` strings the feed renders to a stable SF Symbol,
//  a semantic tone (web Tailwind value color), and the web i18n key + English fallback, plus the
//  prefix-walk lookup (`getActivityVisual`). Kept apart from `RecentActivityFeed.Adapter.swift` for the
//  lint length budget; the lookup is exposed as a `RecentActivityFeedAdapter` extension so the call
//  sites and tests read it as one adapter. Pure (Foundation only) — every branch is unit tested.
//

import Foundation

// MARK: - Tone (web Tailwind value colors → semantic tokens)

/// The icon tint intent for a feed row, mapped from the web Tailwind accent (fuchsia / amber / emerald
/// / sky-indigo / rose / cyan / muted) to a theme-adaptive semantic token in the Views (P1/S9), so
/// light / dark / high-contrast all resolve correctly without raw hex.
public enum RecentActivityFeedTone: String, Sendable, Equatable, CaseIterable {
    /// Web fuchsia / violet — vehicle commands, dashboard layout.
    case power
    /// Web amber / yellow — wake / honk / flash / unlock, API keys.
    case warning
    /// Web emerald — lock, charge, sign-in.
    case success
    /// Web sky / indigo — climate, settings.
    case info
    /// Web rose — alerts.
    case danger
    /// Web cyan / teal — automations, data exports.
    case accent
    /// Web muted — sign-out, generic / unknown activity.
    case muted
}

// MARK: - Visual descriptor (web `ActivityVisual`)

/// The resolved visual for an action — the native parity of the web `ActivityVisual` (`icon`, `color`,
/// `i18nKey`, `fallback`). The lucide icon becomes a stable SF Symbol; the Tailwind color becomes a
/// semantic `RecentActivityFeedTone`. A pure value so the registry + lookup are asserted directly.
public struct RecentActivityFeedVisual: Sendable, Equatable {
    public let symbol: String
    public let tone: RecentActivityFeedTone
    public let i18nKey: String
    public let fallback: String

    public init(symbol: String, tone: RecentActivityFeedTone, i18nKey: String, fallback: String) {
        self.symbol = symbol
        self.tone = tone
        self.i18nKey = i18nKey
        self.fallback = fallback
    }
}

// MARK: - Catalog (web `REGISTRY` + `getActivityVisual`)

public extension RecentActivityFeedAdapter {
    /// The generic fallback when no action prefix matches (web `FALLBACK`).
    static let fallbackVisual = RecentActivityFeedVisual(
        symbol: "clock.arrow.circlepath",
        tone: .muted,
        i18nKey: "activity.action.unknown",
        fallback: "Activity"
    )

    /// The action → visual registry, mapping the web `audit_logs.action` strings to a stable SF Symbol,
    /// a semantic tone, and the web i18n key + English fallback. Mirrors the web `REGISTRY` one-for-one.
    static let registry: [String: RecentActivityFeedVisual] = [
        // Vehicle commands
        "vehicle.command": .init(
            symbol: "gamecontroller.fill", tone: .power,
            i18nKey: "activity.action.vehicleCommand", fallback: "Vehicle command"
        ),
        "vehicle.command.wake": .init(
            symbol: "power", tone: .warning,
            i18nKey: "activity.action.vehicleCommandWake", fallback: "Wake vehicle"
        ),
        "vehicle.command.honk": .init(
            symbol: "bell.badge.fill", tone: .warning,
            i18nKey: "activity.action.vehicleCommandHonk", fallback: "Honk horn"
        ),
        "vehicle.command.flash": .init(
            symbol: "power", tone: .warning,
            i18nKey: "activity.action.vehicleCommandFlash", fallback: "Flash lights"
        ),
        "vehicle.command.lock": .init(
            symbol: "lock.fill", tone: .success,
            i18nKey: "activity.action.vehicleCommandLock", fallback: "Lock vehicle"
        ),
        "vehicle.command.unlock": .init(
            symbol: "lock.open.fill", tone: .warning,
            i18nKey: "activity.action.vehicleCommandUnlock", fallback: "Unlock vehicle"
        ),
        "vehicle.command.climate": .init(
            symbol: "thermometer.medium", tone: .info,
            i18nKey: "activity.action.vehicleCommandClimate", fallback: "Climate command"
        ),
        "vehicle.command.charge": .init(
            symbol: "bolt.fill", tone: .success,
            i18nKey: "activity.action.vehicleCommandCharge", fallback: "Charging command"
        ),
        // Settings / preferences
        "settings.update": .init(
            symbol: "gearshape.fill", tone: .info,
            i18nKey: "activity.action.settingsUpdate", fallback: "Settings updated"
        ),
        "settings": .init(
            symbol: "gearshape.fill", tone: .info,
            i18nKey: "activity.action.settings", fallback: "Settings change"
        ),
        // Alerts
        "alert.rule.create": .init(
            symbol: "bell.badge.fill", tone: .danger,
            i18nKey: "activity.action.alertRuleCreate", fallback: "Alert rule created"
        ),
        "alert.rule.update": .init(
            symbol: "bell.fill", tone: .danger,
            i18nKey: "activity.action.alertRuleUpdate", fallback: "Alert rule updated"
        ),
        "alert.rule.delete": .init(
            symbol: "bell.slash.fill", tone: .danger,
            i18nKey: "activity.action.alertRuleDelete", fallback: "Alert rule deleted"
        ),
        "alert": .init(
            symbol: "bell.fill", tone: .danger,
            i18nKey: "activity.action.alert", fallback: "Alert change"
        ),
        // Automations
        "automation.create": .init(
            symbol: "arrow.triangle.branch", tone: .accent,
            i18nKey: "activity.action.automationCreate", fallback: "Automation created"
        ),
        "automation.update": .init(
            symbol: "arrow.triangle.branch", tone: .accent,
            i18nKey: "activity.action.automationUpdate", fallback: "Automation updated"
        ),
        "automation.delete": .init(
            symbol: "arrow.triangle.branch", tone: .accent,
            i18nKey: "activity.action.automationDelete", fallback: "Automation deleted"
        ),
        "automation": .init(
            symbol: "arrow.triangle.branch", tone: .accent,
            i18nKey: "activity.action.automation", fallback: "Automation change"
        ),
        // Dashboard / layout
        "dashboard.layout.save": .init(
            symbol: "square.grid.2x2.fill", tone: .power,
            i18nKey: "activity.action.dashboardLayoutSave", fallback: "Dashboard layout saved"
        ),
        "dashboard": .init(
            symbol: "rectangle.grid.2x2.fill", tone: .power,
            i18nKey: "activity.action.dashboard", fallback: "Dashboard change"
        ),
        // Data exports
        "data_export.create": .init(
            symbol: "arrow.down.circle.fill", tone: .accent,
            i18nKey: "activity.action.dataExportCreate", fallback: "Data export requested"
        ),
        "data_export": .init(
            symbol: "arrow.down.circle.fill", tone: .accent,
            i18nKey: "activity.action.dataExport", fallback: "Data export"
        ),
        // API keys
        "api_key.create": .init(
            symbol: "key.fill", tone: .warning,
            i18nKey: "activity.action.apiKeyCreate", fallback: "API key created"
        ),
        "api_key.update": .init(
            symbol: "key.fill", tone: .warning,
            i18nKey: "activity.action.apiKeyUpdate", fallback: "API key updated"
        ),
        "api_key.delete": .init(
            symbol: "key.fill", tone: .warning,
            i18nKey: "activity.action.apiKeyDelete", fallback: "API key revoked"
        ),
        "api_key": .init(
            symbol: "key.fill", tone: .warning,
            i18nKey: "activity.action.apiKey", fallback: "API key change"
        ),
        // Auth
        "auth.login": .init(
            symbol: "person.fill", tone: .success,
            i18nKey: "activity.action.authLogin", fallback: "Signed in"
        ),
        "auth.logout": .init(
            symbol: "person.fill", tone: .muted,
            i18nKey: "activity.action.authLogout", fallback: "Signed out"
        ),
        "auth": .init(
            symbol: "person.fill", tone: .muted,
            i18nKey: "activity.action.auth", fallback: "Authentication"
        )
    ]

    /// Resolves an action string to its visual descriptor, falling back to progressively shorter
    /// prefixes — the exact native parity of the web `getActivityVisual`. `vehicle.command.wake` matches
    /// first; if absent, `vehicle.command`, then `vehicle`, then the generic fallback.
    static func visual(for action: String) -> RecentActivityFeedVisual {
        let normalized = action.trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return fallbackVisual }
        if let exact = registry[normalized] { return exact }

        let parts = normalized.split(separator: ".").map(String.init)
        if parts.count > 1 {
            for end in stride(from: parts.count - 1, through: 1, by: -1) {
                let prefix = parts[0 ..< end].joined(separator: ".")
                if let match = registry[prefix] { return match }
            }
        }
        return fallbackVisual
    }
}
