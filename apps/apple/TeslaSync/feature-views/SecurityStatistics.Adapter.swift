//
//  SecurityStatistics.Adapter.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  The testable projection core for the SecurityStatistics surface — the SwiftUI
//  parity of features/admin/components/security-access/SecurityStatistics.tsx. Holds
//  the security-statistics value (web helpers `SecurityStats`), the per-tile
//  projection (web `MetricCard` label/value/icon/color grid), the integer formatter
//  (web `fmtInt`), the surface phase, the freshness-chip projection, and the
//  VoiceOver summary builders. All pure + dependency-free so the projection can be
//  unit-tested without a source, a bundle, or a rendered view.
//

import Foundation
import SwiftUI

// MARK: - Security statistics value (web helpers `SecurityStats`)

/// The computed security-event counts the web parent derives via
/// `computeSecurityStats(history)` and passes into `SecurityStatistics` as the
/// `securityStats` prop. Mirrors the web `SecurityStats` interface field-for-field.
public struct SecurityStatsValue: Equatable, Sendable {
    public let lockEvents: Int
    public let doorOpenCount: Int
    public let windowOpenCount: Int
    public let homelinkCount: Int
    public let guestCount: Int
    public let total: Int

    public init(
        lockEvents: Int,
        doorOpenCount: Int,
        windowOpenCount: Int,
        homelinkCount: Int,
        guestCount: Int,
        total: Int
    ) {
        self.lockEvents = lockEvents
        self.doorOpenCount = doorOpenCount
        self.windowOpenCount = windowOpenCount
        self.homelinkCount = homelinkCount
        self.guestCount = guestCount
        self.total = total
    }
}

/// One settled statistics read: the counts plus the sentry-uptime percent the web
/// passes as the separate `sentryUptime` prop. The freshness window is keyed off the
/// model's `lastUpdatedAt`, so the snapshot itself stays time-free + value-comparable.
public struct SecurityStatsSnapshot: Equatable, Sendable {
    public let stats: SecurityStatsValue
    public let sentryUptimePercent: Double

    public init(stats: SecurityStatsValue, sentryUptimePercent: Double) {
        self.stats = stats
        self.sentryUptimePercent = sentryUptimePercent
    }
}

// MARK: - Surface phase (web `isLoading` / `securityStats` branch + native chrome)

/// The rendered phase of the surface. `loading` + `loaded` + `empty` reproduce the
/// web source's three branches (`isLoading` → skeletons, `securityStats` → grid,
/// else → `EmptyState`); `failed` is the native-chrome fetch-error branch the state
/// list requires (web `QueryError` equivalent).
public enum SecurityStatisticsPhase: Equatable, Sendable {
    case loading
    case loaded
    case empty
    case failed
}

// MARK: - Metric tile color (web `MetricCard` `color: NeonColor`)

/// The five web `NeonColor`s the source assigns to its tiles, mapped to the P1/S9
/// design tokens. Kept visually distinct (the web shows a green / blue / amber /
/// purple / cyan grid), drawing `blue` from the speed series and `purple` from the
/// power series so the tile palette never collapses two tiles to the same hue.
public enum SecurityMetricColor: Equatable, Sendable, CaseIterable {
    case green
    case blue
    case amber
    case purple
    case cyan

    /// The token color used to tint the tile's icon box (web `c.bg`/`c.ring`/`c.text`).
    public var color: Color {
        switch self {
        case .green: Color.TS.statusSuccess
        case .blue: Color.TS.chartSeriesSpeed
        case .amber: Color.TS.statusWarning
        case .purple: Color.TS.chartSeriesPower
        case .cyan: Color.TS.accent
        }
    }
}

// MARK: - Metric tile descriptor (web `MetricCard` props)

/// One projected metric tile — the native parity of a web `<MetricCard label value
/// icon color/>`. `value` is pre-formatted (rendered verbatim) so the view holds no
/// number formatting; `labelKey`/`labelFallback` route the label through the P1/S10
/// facade; `systemImage` is the SF Symbol parity of the web Lucide glyph.
public struct SecurityMetricTile: Equatable, Identifiable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let systemImage: String
    public let color: SecurityMetricColor

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        systemImage: String,
        color: SecurityMetricColor
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.systemImage = systemImage
        self.color = color
    }
}

// MARK: - Number formatting (web `fmtInt` + raw JSX `{value}`)

/// Number → display-string projections matching the web source exactly. The count
/// tiles render the raw integer (web JSX `{value}` — no `fmtInt`, no grouping); the
/// sentry-uptime tile renders `${fmtInt(sentryUptime)}%` (rounded integer with locale
/// grouping). `int` defaults to the current locale (i18n-correct, like the web
/// `_globalLocale`); tests pin a locale for a deterministic separator.
public enum SecurityStatNumber {
    /// Web `fmtInt`: integer with locale grouping separators, rounded half-up.
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: value)) ?? String(Int(value.rounded()))
    }

    /// Count tiles render the raw integer (web `{value}`: no grouping separators).
    public static func count(_ value: Int) -> String {
        String(value)
    }

    /// Sentry-uptime tile: web `${fmtInt(sentryUptime)}%`.
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        "\(int(value, locale: locale))%"
    }
}

// MARK: - Tile projection (web 7-card grid, in source order)

/// Projects a settled snapshot into the seven metric tiles, in the exact web source
/// order with the exact web label keys, glyph intents, and colors. Pure so the grid
/// can be asserted cell-by-cell without rendering.
public enum SecurityStatisticsTiles {
    /// One tile's static descriptor — everything except the snapshot-dependent value,
    /// which is computed by `value` (count from stats, or fmtInt-percent from uptime).
    private struct Spec {
        let id: String
        let labelKey: String
        let labelFallback: String
        let systemImage: String
        let color: SecurityMetricColor
        let value: @Sendable (SecurityStatsValue, Double, Locale) -> String
    }

    /// The seven tiles in the exact web source order, with the exact web label keys,
    /// SF Symbol parity of the web Lucide glyphs, and the web `NeonColor`s.
    private static let specs: [Spec] = [
        Spec(
            id: "lockEvents",
            labelKey: "admin.security.stats.lockEvents",
            labelFallback: "Lock/Unlock Events",
            systemImage: "lock.fill",
            color: .green,
            value: { stats, _, _ in SecurityStatNumber.count(stats.lockEvents) }
        ),
        Spec(
            id: "sentryUptime",
            labelKey: "admin.security.stats.sentryUptime",
            labelFallback: "Sentry Uptime",
            systemImage: "eye.fill",
            color: .blue,
            value: { _, uptime, locale in SecurityStatNumber.percent(uptime, locale: locale) }
        ),
        Spec(
            id: "doorOpens",
            labelKey: "admin.security.stats.doorOpens",
            labelFallback: "Door Open Events",
            systemImage: "door.left.hand.open",
            color: .amber,
            value: { stats, _, _ in SecurityStatNumber.count(stats.doorOpenCount) }
        ),
        Spec(
            id: "windowOpens",
            labelKey: "admin.security.stats.windowOpens",
            labelFallback: "Window Open Events",
            systemImage: "car.fill",
            color: .amber,
            value: { stats, _, _ in SecurityStatNumber.count(stats.windowOpenCount) }
        ),
        Spec(
            id: "homelink",
            labelKey: "admin.security.stats.homelink",
            labelFallback: "HomeLink Detections",
            systemImage: "house.fill",
            color: .purple,
            value: { stats, _, _ in SecurityStatNumber.count(stats.homelinkCount) }
        ),
        Spec(
            id: "guestMode",
            labelKey: "admin.security.stats.guestMode",
            labelFallback: "Guest Mode Usage",
            systemImage: "person.fill.checkmark",
            color: .amber,
            value: { stats, _, _ in SecurityStatNumber.count(stats.guestCount) }
        ),
        Spec(
            id: "totalEvents",
            labelKey: "admin.security.stats.totalEvents",
            labelFallback: "Total Events",
            systemImage: "waveform.path.ecg",
            color: .cyan,
            value: { stats, _, _ in SecurityStatNumber.count(stats.total) }
        )
    ]

    public static func project(_ snapshot: SecurityStatsSnapshot, locale: Locale = .current) -> [SecurityMetricTile] {
        specs.map { spec in
            SecurityMetricTile(
                id: spec.id,
                labelKey: spec.labelKey,
                labelFallback: spec.labelFallback,
                value: spec.value(snapshot.stats, snapshot.sentryUptimePercent, locale),
                systemImage: spec.systemImage,
                color: spec.color
            )
        }
    }
}

// MARK: - Freshness / connectivity (mirrors LiveConnectionState, ADR-013)

/// Live-state freshness for the displayed statistics, layered on top of the phase.
public enum SecurityStatisticsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The freshness chip shown once statistics are on screen (live / stale / offline),
/// mapping the connection to a tone + localized label key.
public struct SecurityStatisticsConnectionChip: Equatable {
    public let tone: TSTone
    public let labelKey: String
    public let labelFallback: String

    public init(tone: TSTone, labelKey: String, labelFallback: String) {
        self.tone = tone
        self.labelKey = labelKey
        self.labelFallback = labelFallback
    }

    public static func project(_ connection: SecurityStatisticsConnection) -> SecurityStatisticsConnectionChip {
        switch connection {
        case .live:
            SecurityStatisticsConnectionChip(
                tone: .success,
                labelKey: "admin.security.stats.live",
                labelFallback: "Live"
            )
        case .stale:
            SecurityStatisticsConnectionChip(
                tone: .warning,
                labelKey: "admin.security.stats.stale",
                labelFallback: "Stale"
            )
        case .offline:
            SecurityStatisticsConnectionChip(
                tone: .neutral,
                labelKey: "admin.security.stats.offline",
                labelFallback: "Offline"
            )
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the metric tiles and the panel. Pure + public so
/// the spoken content can be unit-tested without rendering the view.
public enum SecurityStatisticsAccessibility {
    /// One tile spoken as "label, value", e.g. "Sentry Uptime, 87%".
    public static func tileLabel(_ tile: SecurityMetricTile, localize: (String, String) -> String) -> String {
        "\(localize(tile.labelKey, tile.labelFallback)), \(tile.value)"
    }

    /// The panel's spoken summary across every phase (loading / loaded / empty / failed).
    public static func summary(
        phase: SecurityStatisticsPhase,
        tileCount: Int,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("admin.security.statsTitle", "Security Statistics")
        switch phase {
        case .loading:
            return "\(title). \(localize("admin.security.stats.loading", "Loading statistics…"))"
        case .loaded:
            return "\(title). \(tileCount) \(localize("admin.security.stats.metricsUnit", "metrics"))"
        case .empty:
            return "\(title). \(localize("common.noData", "No data available"))"
        case .failed:
            return "\(title). \(localize("admin.security.stats.errorTitle", "Couldn't load statistics"))"
        }
    }
}
