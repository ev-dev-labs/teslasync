//
//  ChargingBreakdownSlide.Projection.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's `chartData`
//  memo + the headline / caption / legend formatting) plus the per-state
//  presentation resolver. Pure value logic — no SwiftUI, no networking — so every
//  render branch is unit-testable. Mirrors
//  features/analytics/components/review/ChargingBreakdownSlide.tsx.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts + Math.round)

/// Locale-aware number formatting that mirrors the web `fmtNumber`
/// (`Number.toLocaleString` with fixed min/max fraction digits) plus the
/// `Math.round` the slide uses for the plug-in SOC + the legend percentages.
public enum ChargingBreakdownSlideFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding
    /// half away from zero to match `toLocaleString`'s default `halfExpand`.
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)` (the web `total_charge_sessions` count).
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// `Math.round(v)` parity — rounds half away from zero (JS `Math.round` matches
    /// for the non-negative percentages / SOC this slide rounds). Non-finite → 0.
    public static func roundedInt(_ value: Double) -> Int {
        Int(safeNumber(value).rounded())
    }

    /// The web legend / SOC percent string: `${Math.round(v)}%` (literal `%`, as the
    /// web source appends it directly rather than via a locale percent style).
    public static func percent(_ value: Double) -> String {
        "\(roundedInt(value))%"
    }
}

// MARK: - Projection output value types

/// One donut slice: a stable id (its position in the web-filtered array), the
/// localized type name, the raw `0…100` percentage, the pre-formatted
/// `${round(pct)}%` legend value, and the palette color index. Pure value type so
/// the `chartData` mapping is unit-tested. The web assigns the color by the slice's
/// index in the FILTERED array (`COLORS[i % COLORS.length]`), so `colorIndex`
/// equals `id` — preserved verbatim for visual parity, including the case where a
/// zero-valued leading type shifts the colors of the survivors.
public struct ChargingBreakdownSlice: Identifiable, Equatable, Sendable {
    public let id: Int
    public let name: String
    public let value: Double
    public let percentText: String
    public let colorIndex: Int

    public init(id: Int, name: String, value: Double, percentText: String, colorIndex: Int) {
        self.id = id
        self.name = name
        self.value = value
        self.percentText = percentText
        self.colorIndex = colorIndex
    }
}

/// The fully-resolved render model for the content slide: the donut slices plus the
/// pre-formatted hero (charge-session count + the average-plug-in-SOC caption).
public struct ChargingBreakdownSlideProjection: Equatable, Sendable {
    public let slices: [ChargingBreakdownSlice]
    public let totalChargeSessions: Int
    public let chargeSessionsText: String
    public let avgStartSocText: String

    public init(
        slices: [ChargingBreakdownSlice],
        totalChargeSessions: Int,
        chargeSessionsText: String,
        avgStartSocText: String
    ) {
        self.slices = slices
        self.totalChargeSessions = totalChargeSessions
        self.chargeSessionsText = chargeSessionsText
        self.avgStartSocText = avgStartSocText
    }

    /// Whether the donut has at least one slice to draw (web `chartData.length`).
    public var hasSlices: Bool {
        !slices.isEmpty
    }
}

// MARK: - Projection build (cached → projection)

public extension ChargingBreakdownSlideProjection {
    /// Builds the projection from the cached recap, reproducing the web `chartData`
    /// memo: the three charger types in order, filtered to `value > 0`, each colored
    /// by its index in the filtered array. The hero count uses
    /// `fmtNumber(total_charge_sessions, 0)` and the caption interpolates
    /// `Math.round(avg_charge_start_soc)` into the localized template.
    static func make(
        from data: ChargingBreakdownSlideData,
        locale: Locale = .current
    ) -> ChargingBreakdownSlideProjection {
        let localeID = locale.identifier
        let candidates: [(name: String, value: Double)] = [
            (ChargingBreakdownSlideStrings.string("yearReview.supercharger", "Supercharger"), data.superchargerPct),
            (ChargingBreakdownSlideStrings.string("yearReview.dcFast", "DC Fast"), data.dcFastPct),
            (ChargingBreakdownSlideStrings.string("yearReview.acOther", "AC / Other"), data.acOtherPct)
        ]
        let slices = candidates
            .map { (name: $0.name, value: ChargingBreakdownSlideFormat.safeNumber($0.value)) }
            .filter { $0.value > 0 }
            .enumerated()
            .map { index, item in
                ChargingBreakdownSlice(
                    id: index,
                    name: item.name,
                    value: item.value,
                    percentText: ChargingBreakdownSlideFormat.percent(item.value),
                    colorIndex: index
                )
            }
        let sessionsText = ChargingBreakdownSlideFormat.integer(data.totalChargeSessions, localeIdentifier: localeID)
        let socText = ChargingBreakdownSlideStrings.format(
            "yearReview.avgStartSOC",
            "Average plug-in at {{soc}}% battery",
            ["soc": "\(ChargingBreakdownSlideFormat.roundedInt(data.avgChargeStartSoc))"]
        )
        return ChargingBreakdownSlideProjection(
            slices: slices,
            totalChargeSessions: data.totalChargeSessions,
            chargeSessionsText: sessionsText,
            avgStartSocText: socText
        )
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the corner chip (web freshness indicator). The web leaf
/// has no freshness UI; this is the native chrome the P4 auto-refreshing-surface
/// contract requires, layered so cached values stay visible.
public enum ChargingBreakdownSlideFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content). The
/// web slide only ever renders content (the parent owns loading / error / empty);
/// this superset adds the prompt's required chrome while keeping cached recaps on
/// screen behind a refresh or transient failure.
public enum ChargingBreakdownSlidePresentation: Equatable, Sendable {
    case loading
    case empty
    case offlineNoData
    case error(retryable: Bool)
    case content(ChargingBreakdownSlideProjection, freshness: ChargingBreakdownSlideFreshness, refreshing: Bool)
}

public extension ChargingBreakdownSlidePresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a render-ready
    /// presentation. Keeps any cached recap visible behind a refresh / error; an empty
    /// resolved recap becomes the friendly empty state.
    static func resolve(
        state: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>,
        locale: Locale = .current
    ) -> ChargingBreakdownSlidePresentation {
        func project(_ data: ChargingBreakdownSlideData) -> ChargingBreakdownSlideProjection {
            ChargingBreakdownSlideProjection.make(from: data, locale: locale)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(data, stale):
            return data.isEmpty
                ? .empty
                : .content(project(data), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, project: project)
        }
    }

    private static func resolveFailure(
        _ error: ChargingBreakdownSlideError,
        cached: ChargingBreakdownSlideData?,
        stale: Bool,
        project: (ChargingBreakdownSlideData) -> ChargingBreakdownSlideProjection
    ) -> ChargingBreakdownSlidePresentation {
        if error == .offline {
            guard let cached, !cached.isEmpty else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached, !cached.isEmpty {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver content spoken for the slide. Pure + public so the a11y
/// summaries can be unit-tested without rendering the view.
public enum ChargingBreakdownSlideAccessibility {
    /// The hero VoiceOver phrase: "{count} charge sessions. {avg caption}", e.g.
    /// "1,284 charge sessions. Average plug-in at 38% battery".
    public static func heroSummary(for projection: ChargingBreakdownSlideProjection) -> String {
        let sessions = ChargingBreakdownSlideStrings.string("yearReview.chargeSessions", "charge sessions")
        return "\(projection.chargeSessionsText) \(sessions). \(projection.avgStartSocText)"
    }

    /// The donut VoiceOver phrase: a share list so the chart is not an opaque image,
    /// e.g. "Charging mix. Supercharger 45%, DC Fast 30%, AC / Other 25%".
    public static func chartSummary(for slices: [ChargingBreakdownSlice]) -> String {
        let title = ChargingBreakdownSlideStrings.string("yearReview.chargingBreakdown.chartA11y", "Charging mix")
        guard !slices.isEmpty else { return title }
        let parts = slices.map { "\($0.name) \($0.percentText)" }
        return "\(title). \(parts.joined(separator: ", "))"
    }

    /// One legend entry spoken as the web renders it: "{name} ({round(pct)}%)".
    public static func legendLabel(for slice: ChargingBreakdownSlice) -> String {
        "\(slice.name) (\(slice.percentText))"
    }
}
