//
//  WeekOverWeekSummary.Catalog.swift
//  TeslaSync — P4 feature view · 0078 · WeekOverWeekSummary (Apple)
//
//  The i18n facade (P1/S10), the i18n key catalog, and the composed-accessibility
//  builders for the weekly-digest "Week-over-Week Comparison" surface. Centralizing
//  the keys + the VoiceOver label logic here keeps the views declarative and makes the
//  exact localized copy unit-testable without a rendered view. Foundation only (no
//  SwiftUI) so the catalog compiles into the pure-logic test scope; the SwiftUI
//  `LocalizedStringKey` bridge lives in the `.Views.swift` file.
//

import Foundation

// MARK: - i18n key catalog (verbatim web `t(key, …)` keys)

/// The translation keys this surface resolves, copied verbatim from the web source
/// (`WeekOverWeekSummary.tsx`) plus the digest empty-state keys its page owner uses
/// (`WeeklyDigestPage.tsx`). The `unit*` keys carry the tile suffixes the web passes as
/// literal `unit="…"` props; the `a11y.*` / connectivity keys back native-only chrome
/// (freshness chip, offline banner, VoiceOver composition).
public enum WeekOverWeekKeys {
    // Parity keys — exactly as the web `t('…', default)` calls.
    public static let weekOverWeek = "analytics.weeklyDigest.weekOverWeek"
    public static let distance = "analytics.weeklyDigest.distance"
    public static let drives = "analytics.weeklyDigest.drives"
    public static let energy = "analytics.weeklyDigest.energy"
    public static let cost = "analytics.weeklyDigest.cost"
    public static let efficiency = "analytics.weeklyDigest.efficiency"
    public static let co2 = "analytics.weeklyDigest.co2"

    // Unit suffixes — the web `StatCard unit="…"` literals, routed through the facade.
    public static let unitKm = "analytics.weeklyDigest.unit.km"
    public static let unitKwh = "analytics.weeklyDigest.unit.kwh"
    public static let unitWhPerKm = "analytics.weeklyDigest.unit.whPerKm"
    public static let unitKg = "analytics.weeklyDigest.unit.kg"

    // Empty-state keys — the digest owner's "no activity this week" copy.
    public static let noData = "analytics.weeklyDigest.noData"
    public static let noDataMessage = "analytics.weeklyDigest.noDataMessage"

    // Native chrome — connectivity / freshness / refresh.
    public static let live = "analytics.weeklyDigest.live"
    public static let stale = "analytics.weeklyDigest.stale"
    public static let offline = "analytics.weeklyDigest.offline"
    public static let offlineMessage = "analytics.weeklyDigest.offlineMessage"
    public static let refresh = "analytics.weeklyDigest.refresh"
    public static let refreshHint = "analytics.weeklyDigest.refreshHint"
    public static let errorTitle = "analytics.weeklyDigest.errorTitle"
    public static let errorMessage = "analytics.weeklyDigest.errorMessage"

    /// Native chrome — VoiceOver composition.
    public static let changeA11y = "analytics.weeklyDigest.a11y.change"
}

// MARK: - i18n facade (P1/S10)

/// Per-surface localization facade (table `WeekOverWeekSummary`). Mirrors the web
/// `t(key, fallback)` — resolving `key` against this surface's `.strings` table and
/// falling back to the web English default when a catalog entry is missing.
public enum WeekOverWeekStrings {
    public static let table = "WeekOverWeekSummary"

    /// Resolved `String` for a key (web `t(key, fallback)`).
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Replaces react-i18next `{{name}}` tokens with their values (whitespace inside the
    /// braces tolerated, matching i18next's default interpolation).
    static func interpolate(_ template: String, values: [String: String]) -> String {
        var result = template
        for (name, value) in values {
            for token in ["{{\(name)}}", "{{ \(name) }}"] {
                result = result.replacingOccurrences(of: token, with: value)
            }
        }
        return result
    }
}

// MARK: - Accessibility composition (testable VoiceOver copy)

/// Pure builders for the composed VoiceOver labels the views attach. Parameterized over
/// a localizer so the exact label logic is unit-testable without a bundle.
public enum WeekOverWeekAccessibility {
    /// One stat tile read as a single element:
    /// "<label>, <value>[ <unit>][, change <pct>]".
    public static func tileLabel(
        _ item: WeekOverWeekStatItem,
        localize: (String, String) -> String = WeekOverWeekStrings.string
    ) -> String {
        var parts = [localize(item.labelKey, item.labelFallback), valuePhrase(item, localize: localize)]
        if let trend = item.trend {
            let template = localize(WeekOverWeekKeys.changeA11y, "change {{value}}")
            parts.append(WeekOverWeekStrings.interpolate(template, values: ["value": trend.value]))
        }
        return parts.joined(separator: ", ")
    }

    /// The spoken "value unit" phrase ("312.4 km", or just "18" when unit-less).
    public static func valuePhrase(
        _ item: WeekOverWeekStatItem,
        localize: (String, String) -> String = WeekOverWeekStrings.string
    ) -> String {
        guard let unitKey = item.unitKey, let unitFallback = item.unitFallback else {
            return item.value
        }
        return "\(item.value) \(localize(unitKey, unitFallback))"
    }

    /// The connectivity chip label (live / stale / offline).
    public static func freshnessLabel(
        _ connection: WeekOverWeekConnection,
        localize: (String, String) -> String = WeekOverWeekStrings.string
    ) -> String {
        switch connection {
        case .online: localize(WeekOverWeekKeys.live, "Live")
        case .stale: localize(WeekOverWeekKeys.stale, "Stale")
        case .offline: localize(WeekOverWeekKeys.offline, "Offline")
        }
    }

    /// The panel header label (web "Week-over-Week Comparison").
    public static func headerLabel(
        localize: (String, String) -> String = WeekOverWeekStrings.string
    ) -> String {
        localize(WeekOverWeekKeys.weekOverWeek, "Week-over-Week Comparison")
    }
}
