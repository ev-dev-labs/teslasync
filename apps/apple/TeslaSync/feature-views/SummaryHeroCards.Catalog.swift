//
//  SummaryHeroCards.Catalog.swift
//  TeslaSync — P4 feature view · 0077 · SummaryHeroCards (Apple)
//
//  The i18n facade (P1/S10), the i18n key catalog, and the composed-accessibility
//  builders for the weekly-digest "Week Summary" surface. Centralizing the keys +
//  the VoiceOver label logic here keeps the views declarative and makes the exact
//  localized copy unit-testable without a rendered view.
//

import Foundation
import SwiftUI

// MARK: - i18n key catalog (verbatim web `t(key, …)` keys)

/// The translation keys this surface resolves, copied verbatim from the web source
/// (`SummaryHeroCards.tsx`) plus the digest empty-state keys its page owner uses
/// (`WeeklyDigestPage.tsx`). The `a11y.*` / connectivity keys back native-only
/// chrome (freshness chip, offline banner, VoiceOver composition).
public enum SummaryHeroKeys {
    // Parity keys — exactly as the web `t('…', default)` calls.
    public static let weekSummary = "analytics.weeklyDigest.weekSummary"
    public static let totalDistance = "analytics.weeklyDigest.totalDistance"
    public static let totalDrives = "analytics.weeklyDigest.totalDrives"
    public static let energyUsed = "analytics.weeklyDigest.energyUsed"
    public static let chargingCost = "analytics.weeklyDigest.chargingCost"
    public static let co2Saved = "analytics.weeklyDigest.co2Saved"
    public static let funFact = "analytics.weeklyDigest.funFact"
    public static let funFactDesc = "analytics.weeklyDigest.funFactDesc"

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

/// Per-surface localization facade (table `SummaryHeroCards`). Mirrors the web
/// `t(key, fallback)` — resolving `key` against this surface's `.strings` table and
/// falling back to the web English default when a catalog entry is missing.
public enum SummaryHeroStrings {
    public static let table = "SummaryHeroCards"

    /// Resolved `String` for a key (web `t(key, fallback)`).
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolved value wrapped as a `LocalizedStringKey` for shared components that
    /// accept one; the resolved string is not a main-catalog key, so SwiftUI renders
    /// it verbatim.
    public static func key(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(string(key, fallback))
    }

    /// The Fun Fact subtitle, reproducing the web
    /// `t('…funFactDesc', '≈ {{times}}× {{from}} → {{to}}', { times, from, to })`
    /// — the template is localized, then the `{{…}}` tokens are interpolated, exactly
    /// like react-i18next.
    public static func funFactDescription(_ funFact: FunFact) -> String {
        let template = string(funFactDescTemplate.key, funFactDescTemplate.fallback)
        return interpolate(
            template,
            values: ["times": funFact.times, "from": funFact.from, "to": funFact.to]
        )
    }

    /// Replaces react-i18next `{{name}}` tokens with their values (whitespace inside
    /// the braces tolerated, matching i18next's default interpolation).
    static func interpolate(_ template: String, values: [String: String]) -> String {
        var result = template
        for (name, value) in values {
            for token in ["{{\(name)}}", "{{ \(name) }}"] {
                result = result.replacingOccurrences(of: token, with: value)
            }
        }
        return result
    }

    private static let funFactDescTemplate = (
        key: SummaryHeroKeys.funFactDesc,
        fallback: "≈ {{times}}× {{from}} → {{to}}"
    )
}

// MARK: - Accessibility composition (testable VoiceOver copy)

/// Pure builders for the composed VoiceOver labels the views attach. Parameterized
/// over a localizer so the exact label logic is unit-testable without a bundle.
public enum SummaryHeroAccessibility {
    /// One hero card read as a single element: "<label>, <value>[, change <pct>][, <subtitle>]".
    public static func cardLabel(
        _ item: HighlightItem,
        localize: (String, String) -> String = SummaryHeroStrings.string
    ) -> String {
        var parts = [localize(item.labelKey, item.labelFallback), item.value]
        if let trend = item.trend {
            let template = localize(SummaryHeroKeys.changeA11y, "change {{value}}")
            parts.append(SummaryHeroStrings.interpolate(template, values: ["value": trend.value]))
        }
        if let subtitle = item.subtitle {
            parts.append(subtitle)
        }
        return parts.joined(separator: ", ")
    }

    /// The connectivity chip label (live / stale / offline).
    public static func freshnessLabel(
        _ connection: SummaryHeroConnection,
        localize: (String, String) -> String = SummaryHeroStrings.string
    ) -> String {
        switch connection {
        case .online: localize(SummaryHeroKeys.live, "Live")
        case .stale: localize(SummaryHeroKeys.stale, "Stale")
        case .offline: localize(SummaryHeroKeys.offline, "Offline")
        }
    }

    /// The panel header label (web "Week Summary").
    public static func summaryLabel(
        localize: (String, String) -> String = SummaryHeroStrings.string
    ) -> String {
        localize(SummaryHeroKeys.weekSummary, "Week Summary")
    }
}
