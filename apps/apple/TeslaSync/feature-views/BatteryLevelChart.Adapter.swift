//
//  BatteryLevelChart.Adapter.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  The testable projection core for the "Battery Level at Charge Start" charging
//  surface — the faithful port of the histogram fed to
//  features/charging/components/charging-list/BatteryLevelChart.tsx via the
//  `computeStartLevelDist` helper (helpers.ts). Everything here is pure and
//  dependency-free (Foundation only) so it can be unit-tested without a bundle or
//  a rendered view.
//
//  Web parity notes:
//    • `computeStartLevelDist` seeds ten fixed deciles
//      (`{ range: `${i*10}-${i*10+10}%`, count: 0 }`) and, for each session,
//      increments `buckets[min(floor(start_soc_pct / 10), 9)]`.
//    • `StartLevelBucket` mirrors the web `{ range, count }` chart datum.
//    • The web chart always renders the ten bars; the loading / empty / error /
//      freshness envelope (prompt P4 states) is supplied by the bound source,
//      mirroring the parent list's `isLoading` / refetch wiring.
//

import Foundation

// MARK: - Cached session input (subset of web `ChargingSession`)

/// The single cached `ChargingSession` field this surface consumes — the
/// start-of-charge state of charge (web `start_soc_pct`, already a 0–100 percent).
/// Kept as a tiny value type so the bucketing core stays transport-free.
public struct BatteryStartLevelSession: Sendable, Equatable {
    /// The session's battery level when charging began (web `start_soc_pct`).
    public var startSocPct: Double

    public init(startSocPct: Double) {
        self.startSocPct = startSocPct
    }
}

// MARK: - Bucket (web `StartLevelBucket`)

/// One histogram column — the SwiftUI parity of the web `StartLevelBucket`
/// (`{ range, count }`). `range` is the decile label (`"0-10%"` … `"90-100%"`)
/// and `count` is how many sessions started in that range.
public struct BatteryStartLevelBucket: Sendable, Equatable, Identifiable {
    /// The decile label and chart x value (web `range`, e.g. `"40-50%"`).
    public var range: String
    /// The number of sessions that started in this decile (web `count`).
    public var count: Int

    public var id: String {
        range
    }

    public init(range: String, count: Int) {
        self.range = range
        self.count = count
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed projection the view renders: the ten decile buckets plus
/// the derived totals the header summary + VoiceOver read. `hasData` mirrors the
/// web `sessions.length > 0` guard that splits content from the empty state.
public struct BatteryLevelProjection: Sendable, Equatable {
    public var buckets: [BatteryStartLevelBucket]
    public var totalSessions: Int
    public var hasData: Bool
    /// The label of the busiest decile (most charge starts), for the a11y summary.
    public var peakRange: String?

    public init(buckets: [BatteryStartLevelBucket], totalSessions: Int, hasData: Bool, peakRange: String?) {
        self.buckets = buckets
        self.totalSessions = totalSessions
        self.hasData = hasData
        self.peakRange = peakRange
    }
}

// MARK: - Builder (port of the web `computeStartLevelDist`)

/// Pure functions that turn cached charging sessions into the ten-decile
/// `BatteryStartLevelBucket`s the chart plots — a 1:1 port of the web
/// `computeStartLevelDist` so both platforms show identical bars.
public enum BatteryLevelBuilder {
    /// The number of fixed deciles the web seeds (`Array.from({ length: 10 })`).
    public static let bucketCount = 10
    /// The width of one decile in percent (`i * 10` step).
    public static let bucketSpan = 10

    /// The decile label for an index, mirroring the web template literal
    /// `` `${i*10}-${i*10+10}%` `` → `"0-10%"`, `"10-20%"`, … `"90-100%"`.
    public static func rangeLabel(forIndex index: Int) -> String {
        let low = index * bucketSpan
        let high = low + bucketSpan
        return "\(low)-\(high)%"
    }

    /// The destination bucket index for a start-of-charge level, mirroring the web
    /// `Math.min(Math.floor(start_soc_pct / 10), 9)`. Non-finite / negative inputs
    /// clamp to the first decile (the web would index out of range on those; valid
    /// 0–100 levels are unaffected), and anything ≥ 90% lands in the last decile.
    public static func bucketIndex(forSoc soc: Double) -> Int {
        guard soc.isFinite, soc > 0 else { return 0 }
        let raw = Int((soc / Double(bucketSpan)).rounded(.down))
        return min(max(raw, 0), bucketCount - 1)
    }

    /// Builds the ten-decile distribution (web `computeStartLevelDist`): seed every
    /// decile at zero, then tally each session into its bucket.
    public static func distribution(_ sessions: [BatteryStartLevelSession]) -> [BatteryStartLevelBucket] {
        var counts = Array(repeating: 0, count: bucketCount)
        for session in sessions {
            counts[bucketIndex(forSoc: session.startSocPct)] += 1
        }
        return counts.enumerated().map { index, count in
            BatteryStartLevelBucket(range: rangeLabel(forIndex: index), count: count)
        }
    }

    /// Projects cached sessions into the render model: the decile buckets, the
    /// total session count, the `hasData` content/empty split, and the busiest
    /// decile label.
    public static func project(_ sessions: [BatteryStartLevelSession]) -> BatteryLevelProjection {
        let buckets = distribution(sessions)
        let total = buckets.reduce(0) { running, bucket in running + bucket.count }
        let peak = buckets.max { lhs, rhs in lhs.count < rhs.count }
        return BatteryLevelProjection(
            buckets: buckets,
            totalSessions: total,
            hasData: total > 0,
            peakRange: total > 0 ? peak?.range : nil
        )
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (the parent always passes computed buckets); the loading /
/// error envelope around it (prompt P4 states) is supplied by the bound source,
/// mirroring the parent list's `isLoading` / refetch wiring.
public enum BatteryLevelPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the charge-history query (web `isLoading` /
/// resolved / failure), projected into a phase by `resolvePhase`.
public enum BatteryLevelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so cached bars are clearly labeled while reconnecting / offline.
public enum BatteryLevelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension BatteryLevelBuilder {
    /// Resolves the render phase from the bound load status + whether any session
    /// resolved (web `sessions.length > 0 ? content : empty`).
    static func resolvePhase(_ status: BatteryLevelLoadStatus, hasData: Bool) -> BatteryLevelPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum BatteryLevelSurface {
    public static let slug = "BatteryLevelChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without
/// a bundle, exactly like the view's P1/S10 facade.
public enum BatteryLevelAccessibility {
    /// The chart-level summary: title + session total + range count + busiest range.
    public static func chartSummary(
        projection: BatteryLevelProjection,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("charging.charts.batteryLevelAtStart", "Battery Level at Charge Start")
        guard projection.hasData else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let sessions = localize("charging.charts.batteryLevel.sessionsNoun", "sessions")
        let ranges = localize("charging.charts.batteryLevel.rangesNoun", "ranges")
        let mostCommon = localize("charging.charts.batteryLevel.mostCommon", "most common")
        let peak = projection.peakRange ?? "—"
        return "\(title): \(projection.totalSessions) \(sessions), "
            + "\(projection.buckets.count) \(ranges), \(mostCommon) \(peak)"
    }

    /// One bar's VoiceOver value: "{range}: X sessions".
    public static func barValue(
        _ bucket: BatteryStartLevelBucket,
        localize: (String, String) -> String
    ) -> String {
        let sessions = localize("charging.charts.batteryLevel.sessionsNoun", "sessions")
        return "\(bucket.range): \(bucket.count) \(sessions)"
    }
}
