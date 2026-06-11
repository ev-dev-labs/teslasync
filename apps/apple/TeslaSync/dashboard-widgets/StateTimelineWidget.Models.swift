//
//  StateTimelineWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  Shared-free domain value types for the StateTimelineWidget surface: the
//  cached DTO inputs (the `/vehicle-states/summary` + `/vehicle-states/timeline`
//  rows the web widget reads), the parsed vehicle-state kind, the computed
//  stacked-bar segments + 24h stripe segments, and the locale-aware number /
//  duration formatters. No SwiftUI / transport here — these are the pure,
//  unit-tested inputs/outputs of the cached → projection adapter.
//

import Foundation

// MARK: - Vehicle state kind (port of the web STATE_COLORS keyspace)

/// The vehicle-state buckets the widget distinguishes, mirroring the web
/// `STATE_COLORS` keyspace (`driving` / `charging` / `asleep` / `idle` /
/// `offline`) plus an `unknown` fallback for any other raw value (the web's
/// `?? '#6b7280'` grey branch). Pure: the color mapping lives in the palette.
public enum VehicleStateKind: String, Sendable, Equatable, CaseIterable {
    case driving
    case charging
    case asleep
    case idle
    case offline
    case unknown

    /// Resolves a raw API state string to a kind, lower-casing first (the web
    /// `STATE_COLORS[state.toLowerCase()]` lookup). Unknown values map to
    /// `.unknown` so they still render with the neutral grey + their raw label.
    public static func from(raw: String) -> VehicleStateKind {
        let key = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return VehicleStateKind(rawValue: key) ?? .unknown
    }
}

// MARK: - Cached DTO inputs (subset of web StateSummary / TimelineEvent)

/// One `/vehicle-states/summary` row, mirroring the web `StateSummary`
/// (`{ state, totalMin, count }` after `camelCaseKeys`). `totalMin` is the
/// dwell time in minutes the bucket accumulated over the window.
public struct StateSummaryEntry: Sendable, Equatable {
    public var state: String
    public var totalMin: Double
    public var count: Int

    public init(state: String, totalMin: Double, count: Int = 0) {
        self.state = state
        self.totalMin = totalMin
        self.count = count
    }
}

/// One `/vehicle-states/timeline` transition, mirroring the web `TimelineEvent`
/// (`{ id, state, startDate, durationMin }`). Drives the wide-layout 24h stripe.
public struct StateTransitionEntry: Sendable, Equatable {
    public var state: String
    public var startDate: String
    public var durationMin: Double

    public init(state: String, startDate: String = "", durationMin: Double) {
        self.state = state
        self.startDate = startDate
        self.durationMin = durationMin
    }
}

/// The minimal vehicle reference the widget needs to scope its query, mirroring
/// the `useVehicles()[0]` fallback the web widget uses to pick a default id.
public struct StateTimelineVehicleRef: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Projection segments (the adapter output the view renders)

/// One stacked-bar / list segment, the Swift port of the web `StateSegment`
/// (`{ state, pct, totalMin, count }`) plus the parsed `kind` so the view can
/// resolve color + label without re-parsing.
public struct StateSegment: Sendable, Equatable, Identifiable {
    public var rawState: String
    public var kind: VehicleStateKind
    public var pct: Double
    public var totalMin: Double
    public var count: Int

    public var id: String {
        rawState
    }

    /// The per-state i18n key the web builds (`widget.stateTimeline.state.<s>`),
    /// lower-cased to match the catalog keyspace.
    public var localizationKey: String {
        "widget.stateTimeline.state.\(rawState.lowercased())"
    }

    /// The capitalized raw label the web falls back to (the source passes
    /// `seg.state` as the `t()` default and CSS-`capitalize`s it).
    public var fallbackLabel: String {
        guard let first = rawState.first else { return rawState }
        return first.uppercased() + rawState.dropFirst()
    }

    public init(rawState: String, kind: VehicleStateKind, pct: Double, totalMin: Double, count: Int) {
        self.rawState = rawState
        self.kind = kind
        self.pct = pct
        self.totalMin = totalMin
        self.count = count
    }
}

/// One 24h-timeline stripe slice, the Swift port of the web `TimelineStripe`
/// per-transition cell (`{ state, pct, durationMin }`). Only slices ≥ 0.5% are
/// produced (the web skips sub-0.5% widths).
public struct StateStripeSegment: Sendable, Equatable, Identifiable {
    public var index: Int
    public var rawState: String
    public var kind: VehicleStateKind
    public var pct: Double
    public var durationMin: Double

    public var id: Int {
        index
    }

    public init(index: Int, rawState: String, kind: VehicleStateKind, pct: Double, durationMin: Double) {
        self.index = index
        self.rawState = rawState
        self.kind = kind
        self.pct = pct
        self.durationMin = durationMin
    }
}

/// The fully-computed projection the view renders: the stacked-bar/list
/// segments plus the (possibly empty) 24h stripe. `hasData` mirrors the web
/// `hasData = segments.length > 0` gate that switches the content vs the
/// empty state.
public struct STWProjection: Sendable, Equatable {
    public var segments: [StateSegment]
    public var stripe: [StateStripeSegment]

    public var hasData: Bool {
        !segments.isEmpty
    }

    public init(segments: [StateSegment], stripe: [StateStripeSegment]) {
        self.segments = segments
        self.stripe = stripe
    }
}

// MARK: - Number + duration formatting (port of web fmtNumber / fmtInt / fmtDuration)

/// Locale-aware formatting mirroring the web `fmtNumber(v, decimals)` /
/// `fmtInt(v)` (`toLocaleString` with fixed fraction digits + grouping) and
/// `fmtDuration(totalMin, t)` (`{h}h {m}m` / `{m}m`). Ties round half-up to
/// match the JS default; the web global locale default is `en-US`.
public enum STWFormat {
    /// Fixed-fraction decimal with grouping (web `fmtNumber`).
    public static func decimal(
        _ value: Double,
        fractionDigits: Int,
        locale: Locale = Locale(identifier: "en-US")
    ) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.roundingMode = .halfUp
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.usesGroupingSeparator = true
        let safe = value.isFinite ? value : 0
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    /// Integer formatting with grouping (web `fmtInt`).
    public static func integer(_ value: Double, locale: Locale = Locale(identifier: "en-US")) -> String {
        decimal(value, fractionDigits: 0, locale: locale)
    }

    /// Splits minutes into whole hours + minutes, matching the web
    /// `hrs = floor(min/60)`, `mins = round(min % 60)`.
    public static func durationParts(_ totalMin: Double) -> (hours: Int, minutes: Int) {
        let safe = totalMin.isFinite ? max(0, totalMin) : 0
        let hours = Int((safe / 60).rounded(.down))
        let minutes = Int(safe.truncatingRemainder(dividingBy: 60).rounded())
        return (hours, minutes)
    }

    /// Composes the duration label exactly as the web `fmtDuration`:
    /// `"{m}{minuteSuffix}"` when under an hour, else
    /// `"{h}{hourSuffix} {m}{minuteSuffix}"`. The suffixes are injected so this
    /// stays pure + testable; the i18n facade supplies the localized `h` / `m`.
    public static func duration(_ totalMin: Double, hourSuffix: String, minuteSuffix: String) -> String {
        let parts = durationParts(totalMin)
        if parts.hours == 0 {
            return "\(parts.minutes)\(minuteSuffix)"
        }
        return "\(parts.hours)\(hourSuffix) \(parts.minutes)\(minuteSuffix)"
    }
}
