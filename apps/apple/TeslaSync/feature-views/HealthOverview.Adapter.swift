//
//  HealthOverview.Adapter.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  The testable projection core: a `HealthOverviewInput` (+ locale) → the view-ready summary
//  (the optional status banner, the status icon selector, the headline, the "Motor State: …"
//  line, the status badge, and the formatted health-score percent), reproducing the web source's
//  string pipeline VERBATIM so the native surface shows the exact same values as
//  features/driving/components/drivetrain-health/HealthOverview.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection + accessibility
//  compile and run on a plain host and are pinned by unit tests. The status → token tint + SF
//  Symbol mapping lives in HealthOverview.Views.swift; here a label is resolved lazily through the
//  P1/S10 facade so the projector itself holds no SwiftUI.
//

import Foundation

// MARK: - Localized label (P1/S10 key + web English fallback)

/// One localizable label — a key plus its web English fallback — resolved lazily through the
/// P1/S10 facade so the projection stays SwiftUI-free and host-testable.
public struct HealthOverviewLabel: Equatable, Sendable {
    public let key: String
    public let fallback: String

    public init(key: String, fallback: String) {
        self.key = key
        self.fallback = fallback
    }

    /// The resolved (localized) text for display + accessibility (P1/S10 facade).
    public var text: String {
        HealthOverviewStrings.string(key, fallback)
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber`/`fmtInt`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`). The web
/// `<AnimatedNumber value={healthScore} suffix="%" />` renders `fmtNumber(value, 0)` (its default
/// `decimals` is 0) for the final value, so the projector formats the score with zero fraction
/// digits and appends "%".
public enum HealthOverviewFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }
}

// MARK: - Projected status banner (web `AlertBanner`)

/// The status banner shown above the summary card when the drivetrain is not healthy — the native
/// mirror of the web `<AlertBanner variant={getAlertVariant(overallHealth)} title=… icon=…>`. The
/// `status` (warning / critical) drives the banner tone + icon in the view; the title + message
/// are pre-resolved labels.
public struct HealthOverviewAlert: Equatable, Sendable {
    public let status: HealthOverviewHealthStatus
    public let title: HealthOverviewLabel
    public let message: HealthOverviewLabel

    public init(status: HealthOverviewHealthStatus, title: HealthOverviewLabel, message: HealthOverviewLabel) {
        self.status = status
        self.title = title
        self.message = message
    }
}

// MARK: - Projected status badge (web `Badge`)

/// The status badge in the summary card — the native mirror of the web `<Badge
/// variant={healthBadgeVariant(overallHealth)} size="lg" dot>`. The `status` drives the badge tone
/// in the view; `label` is the pre-resolved (uppercased) status text.
public struct HealthOverviewBadge: Equatable, Sendable {
    public let status: HealthOverviewHealthStatus
    public let label: HealthOverviewLabel

    public init(status: HealthOverviewHealthStatus, label: HealthOverviewLabel) {
        self.status = status
        self.label = label
    }
}

// MARK: - Projection

/// The fully-projected surface content: the optional status banner, the summary-card status, the
/// headline, the "Motor State" label + raw motor status, the status badge, and the formatted
/// health-score percent — every value computed with the exact same logic + formatting as the web
/// component so the web and native surfaces show identical strings side by side.
public struct HealthOverviewProjection: Equatable, Sendable {
    public let status: HealthOverviewHealthStatus
    public let alert: HealthOverviewAlert?
    public let headline: HealthOverviewLabel
    public let motorStateLabel: HealthOverviewLabel
    public let motorStatus: String
    public let badge: HealthOverviewBadge
    public let scoreText: String

    public init(
        status: HealthOverviewHealthStatus,
        alert: HealthOverviewAlert?,
        headline: HealthOverviewLabel,
        motorStateLabel: HealthOverviewLabel,
        motorStatus: String,
        badge: HealthOverviewBadge,
        scoreText: String
    ) {
        self.status = status
        self.alert = alert
        self.headline = headline
        self.motorStateLabel = motorStateLabel
        self.motorStatus = motorStatus
        self.badge = badge
        self.scoreText = scoreText
    }

    /// Whether the status banner renders (web `overallHealth !== 'good'`).
    public var hasAlert: Bool {
        alert != nil
    }

    /// The score readout including the "%" suffix the web `AnimatedNumber` appends.
    public var scoreReadout: String {
        "\(scoreText)%"
    }

    /// The "Motor State: …" line (web `{t('drivetrain.motorState')}: {motorStatus}`).
    public var motorStateLine: String {
        "\(motorStateLabel.text): \(motorStatus)"
    }
}

// MARK: - Projector (pure, web-parity)

/// Pure projector: `HealthOverviewInput` (+ locale) → `HealthOverviewProjection`. Every value is
/// computed with the exact same logic + formatting as the web component so the web and native
/// surfaces show identical strings side by side.
public enum HealthOverviewProjector {
    public static func project(
        data: HealthOverviewInput,
        localeIdentifier: String = "en_US"
    ) -> HealthOverviewProjection {
        let status = data.overallHealth
        return HealthOverviewProjection(
            status: status,
            alert: status.alert,
            headline: status.headline,
            motorStateLabel: HealthOverviewLabel(key: "drivetrain.motorState", fallback: "Motor State"),
            motorStatus: data.motorStatus,
            badge: HealthOverviewBadge(status: status, label: status.badgeLabel),
            scoreText: HealthOverviewFormat.number(data.healthScore, decimals: 0, localeIdentifier: localeIdentifier)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the surface. Pure + public so the spoken content can be
/// unit-tested without rendering the view. Callers pass already-localized strings (the labels) so
/// the summary holds no English literals itself.
public enum HealthOverviewAccessibility {
    /// The banner summary, e.g. "Critical Temperature Warning. One or more drivetrain components…".
    public static func alertSummary(for alert: HealthOverviewAlert) -> String {
        "\(alert.title.text). \(alert.message.text)"
    }

    /// The summary-card phrase, e.g. "Drivetrain Healthy. Motor State: Optimal. GOOD 95%".
    public static func cardSummary(for projection: HealthOverviewProjection) -> String {
        [
            projection.headline.text,
            projection.motorStateLine,
            "\(projection.badge.label.text) \(projection.scoreReadout)"
        ].joined(separator: ". ")
    }

    /// The full surface summary: the banner (when present) then the summary card.
    public static func summary(for projection: HealthOverviewProjection) -> String {
        var phrases: [String] = []
        if let alert = projection.alert {
            phrases.append(alertSummary(for: alert))
        }
        phrases.append(cardSummary(for: projection))
        return phrases.joined(separator: ". ")
    }
}
