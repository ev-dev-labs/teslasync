//
//  SOCRouteChart.Adapter.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  Pure (Foundation-only) projection core for the "Battery Along Route" trip-planner
//  surface — the faithful port of the planned-route state-of-charge area chart in
//  features/driving/components/SOCRouteChart.tsx. The web component plots each
//  `TripSOCPoint`'s `soc` against its `distance_m` inside a `[0, 100]` Y domain,
//  overlays a horizontal "min arrival SOC" reference line plus one vertical
//  reference line per charge stop, and falls through to the "Plan a trip to see the
//  SOC curve" overlay when there are no points (web `chartData.length === 0`).
//  Everything here is dependency-free so it unit-tests without a bundle or a view.
//
//  Web parity notes:
//    • chartData ← socCurve.map { distance: round(distance_m*10)/10, soc: round(soc*10)/10 }.
//    • The charge-stop reference lines reuse the web `stopDistances` walk verbatim:
//      for each stop, the first raw soc-curve point past the running cumulative
//      distance whose SOC is within 5% of the stop's `charge_from_soc`; its rounded
//      `distance_m` is the line x, and the running distance advances to it. The
//      "Stop N" ordinal is the position in the *matched* list (web `map((d, i) => i+1)`).
//    • The area renders whenever there is ≥ 1 point (web empty branch is `=== 0`);
//      the loading / error / freshness envelope around that content/empty split
//      (prompt P4 states) is supplied by the bound source, mirroring how the trip
//      planner page owns the request lifecycle.
//

import Foundation

// MARK: - Inputs (web `TripSOCPoint` / `TripChargeStop` subsets)

/// One planned-route SOC sample as delivered by the bound source — the two fields
/// the web `SOCRouteChart` reads from each `TripSOCPoint`: the along-route
/// `distance_m` (the x value, web-labeled "km") and the `soc` percent. Kept as a
/// tiny value type so the projection stays transport-free and testable.
public struct SOCRoutePoint: Sendable, Equatable {
    /// Distance along the route for the sample (web `distance_m`, the chart x).
    public var distanceM: Double
    /// State of charge percent at the sample (web `soc`, already 0–100).
    public var soc: Double

    public init(distanceM: Double, soc: Double) {
        self.distanceM = distanceM
        self.soc = soc
    }
}

/// One planned charge stop as delivered by the bound source — the fields the web
/// `SOCRouteChart` reads from each `TripChargeStop`: the `charge_from_soc` the
/// reference-line walk matches on, plus the `name` used to enrich the native
/// VoiceOver label (the web shows only the ordinal).
public struct SOCRouteChargeStop: Sendable, Equatable {
    /// SOC the stop is entered at (web `charge_from_soc`) — matched against the curve.
    public var chargeFromSoc: Double
    /// The stop's display name (web `name`) — native accessibility enrichment.
    public var name: String

    public init(chargeFromSoc: Double, name: String = "") {
        self.chargeFromSoc = chargeFromSoc
        self.name = name
    }
}

// MARK: - Projected plot types

/// One projected plot point: a stable index (for `ForEach` identity) plus the
/// rounded along-route `distance` (the continuous x) and `soc` percent (the y),
/// matching the web `chartData` rounding (`round(value*10)/10`).
public struct SOCRouteSample: Sendable, Equatable, Identifiable {
    /// Plot order index — stable identity; the chart x is `distance`, not this.
    public var index: Int
    /// Rounded along-route distance (web `chartData` `distance`).
    public var distance: Double
    /// Rounded state of charge percent (web `chartData` `soc`).
    public var soc: Double

    public var id: Int {
        index
    }

    public init(index: Int, distance: Double, soc: Double) {
        self.index = index
        self.distance = distance
        self.soc = soc
    }
}

/// One charge-stop vertical reference line — the rounded route distance at which
/// the stop occurs (web `stopDistances` entry) plus its 1-based ordinal in the
/// matched list (web "Stop {i+1}") and the stop name for VoiceOver.
public struct SOCRouteChargeMarker: Sendable, Equatable, Identifiable {
    /// 1-based ordinal in the matched list — the web "Stop N" number.
    public var ordinal: Int
    /// Rounded route distance for the reference line (web `round(distance_m)`).
    public var distance: Double
    /// The originating stop's name — native VoiceOver enrichment.
    public var name: String

    public var id: Int {
        ordinal
    }

    public init(ordinal: Int, distance: Double, name: String) {
        self.ordinal = ordinal
        self.distance = distance
        self.name = name
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes
/// content-vs-empty (`chartData.length === 0` swaps the area for the empty
/// overlay); the loading / error envelope around it (prompt P4 states) is supplied
/// by the bound source, mirroring the trip planner page's request lifecycle.
public enum SOCRouteChartPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the trip-plan query (web loading / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum SOCRouteChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached curve is clearly labeled while reconnecting / offline.
public enum SOCRouteChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Projection core (pure)

/// The dependency-free projection from raw inputs to chart-ready samples, the
/// charge-stop reference lines, and the render phase. A faithful port of the web
/// `SOCRouteChart` body.
public enum SOCRouteChartProjection {
    /// The web empty threshold (`chartData.length === 0`): a single point still
    /// renders the area + axes + reference lines, so the trace shows with ≥ 1 point.
    public static let minimumTraceSamples = 1

    /// The Y-axis domain — the web `<YAxis domain={[0, 100]}>` (SOC percent).
    public static let socDomain: ClosedRange<Double> = 0 ... 100

    /// The web charge-stop match tolerance: `Math.abs(pt.soc - charge_from_soc) < 5`.
    public static let socMatchTolerance: Double = 5

    /// Rounds to one decimal place — the web `Math.round(value * 10) / 10`.
    public static func rounded1(_ value: Double) -> Double {
        guard value.isFinite else { return value }
        return (value * 10).rounded() / 10
    }

    /// Builds the rounded, indexed plot samples from the ordered route points (web
    /// `chartData`).
    public static func samples(from points: [SOCRoutePoint]) -> [SOCRouteSample] {
        points.enumerated().map { index, point in
            SOCRouteSample(index: index, distance: rounded1(point.distanceM), soc: rounded1(point.soc))
        }
    }

    /// Whether the area trace should render (web empty branch is `chartData.length === 0`).
    public static func hasTrace(_ samples: [SOCRouteSample]) -> Bool {
        samples.count >= minimumTraceSamples
    }

    /// Resolves the render phase from the bound load status + whether there is a
    /// trace to draw (web `chartData.length === 0 ? <empty> : <area>`).
    public static func resolvePhase(_ status: SOCRouteChartLoadStatus, hasTrace: Bool) -> SOCRouteChartPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasTrace ? .content : .empty
        }
    }

    /// The charge-stop vertical reference lines — a verbatim port of the web
    /// `stopDistances` walk. For each stop, the first raw point past the running
    /// cumulative distance whose SOC is within `socMatchTolerance` of the stop's
    /// entry SOC becomes a line at its rounded distance; the running distance then
    /// advances to that (raw) point. Unmatched stops are skipped, so the "Stop N"
    /// ordinal counts matched lines, not original stops.
    public static func chargeMarkers(
        socCurve: [SOCRoutePoint],
        chargeStops: [SOCRouteChargeStop]
    ) -> [SOCRouteChargeMarker] {
        var matched: [(distance: Double, name: String)] = []
        var cumulativeDistance = 0.0
        for stop in chargeStops {
            let match = socCurve.first { point in
                point.distanceM > cumulativeDistance
                    && abs(point.soc - stop.chargeFromSoc) < socMatchTolerance
            }
            guard let match else { continue }
            matched.append((distance: match.distanceM.rounded(), name: stop.name))
            cumulativeDistance = match.distanceM
        }
        return matched.enumerated().map { index, entry in
            SOCRouteChargeMarker(ordinal: index + 1, distance: entry.distance, name: entry.name)
        }
    }

    /// The closed x domain spanning the trace (web Recharts auto-domain over the
    /// `distance` category). Falls back to `0...1` when empty and pads a single
    /// point so the axis is never degenerate.
    public static func distanceDomain(_ samples: [SOCRouteSample]) -> ClosedRange<Double> {
        let distances = samples.map(\.distance)
        guard let low = distances.min(), let high = distances.max() else { return 0 ... 1 }
        return low < high ? low ... high : low ... (low + 1)
    }

    /// The first sample's SOC (route start) — summary / VoiceOver.
    public static func startSoc(_ samples: [SOCRouteSample]) -> Double? {
        samples.first?.soc
    }

    /// The last sample's SOC (route arrival) — summary / VoiceOver.
    public static func endSoc(_ samples: [SOCRouteSample]) -> Double? {
        samples.last?.soc
    }

    /// The lowest SOC across the route.
    public static func minSoc(_ samples: [SOCRouteSample]) -> Double? {
        samples.map(\.soc).min()
    }

    /// The highest SOC across the route.
    public static func maxSoc(_ samples: [SOCRouteSample]) -> Double? {
        samples.map(\.soc).max()
    }

    /// The sample nearest a selected x distance — the native parity of the web
    /// Recharts `<Tooltip>` resolving the hovered category to a datum. `nil` x (no
    /// selection) or no samples yields `nil`.
    public static func sample(nearestDistance distance: Double?, in samples: [SOCRouteSample]) -> SOCRouteSample? {
        guard let distance, !samples.isEmpty else { return nil }
        return samples.min { lhs, rhs in
            abs(lhs.distance - distance) < abs(rhs.distance - distance)
        }
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware formatting for the SOC + distance values, shared by the chart axes,
/// the tooltip, the reference-line labels, and the accessibility summaries
/// (bundle-free + unit-testable).
public enum SOCRouteChartFormat {
    /// Formats a SOC magnitude as a whole-number percent (e.g. `82%`). Non-finite
    /// input renders an em dash (never "nan") — web `${v}%`.
    public static func percent(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 0
        let rounded = value.rounded()
        let number = formatter.string(from: NSNumber(value: rounded)) ?? "\(Int(rounded))"
        return "\(number)%"
    }

    /// Formats an along-route distance with up to one fraction digit (web `chartData`
    /// rounding) — the bare number; the "km" unit is supplied by the i18n facade.
    public static func distance(_ value: Double, locale: Locale = .current) -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum SOCRouteChartSurface {
    public static let slug = "SOCRouteChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a `locale`, so they're bundle-free testable.
public enum SOCRouteChartAccessibility {
    /// The chart-level summary: title + point count + the start → arrival SOC, the
    /// minimum-arrival threshold, and the charge-stop count — or the no-data
    /// fallback when there is no trace (the dense per-point curve is summarized
    /// rather than tabulated).
    public static func chartSummary(
        samples: [SOCRouteSample],
        markers: [SOCRouteChargeMarker],
        minArrivalSoc: Double,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let title = localize("tripPlanner.socChart.title", "Battery Along Route")
        guard SOCRouteChartProjection.hasTrace(samples),
              let start = SOCRouteChartProjection.startSoc(samples),
              let end = SOCRouteChartProjection.endSoc(samples)
        else {
            return "\(title): \(localize("tripPlanner.socChart.empty", "Plan a trip to see the SOC curve"))"
        }
        let pointsWord = localize("tripPlanner.socChart.points", "points")
        let startWord = localize("tripPlanner.socChart.start", "start")
        let arrivalWord = localize("tripPlanner.socChart.arrival", "arrival")
        let minWord = localize("tripPlanner.socChart.minArrivalLong", "minimum arrival")
        let stopsWord = localize("tripPlanner.socChart.stops", "charge stops")
        let startValue = SOCRouteChartFormat.percent(start, locale: locale)
        let endValue = SOCRouteChartFormat.percent(end, locale: locale)
        let minValue = SOCRouteChartFormat.percent(minArrivalSoc, locale: locale)
        return "\(title): \(samples.count) \(pointsWord), \(startWord) \(startValue), "
            + "\(arrivalWord) \(endValue), \(minWord) \(minValue), \(markers.count) \(stopsWord)"
    }

    /// One charge-stop reference line's VoiceOver value:
    /// "Stop {n}{, name} at {distance} km".
    public static func stopValue(
        _ marker: SOCRouteChargeMarker,
        localize: (String, String) -> String,
        locale: Locale = .current
    ) -> String {
        let stopWord = localize("tripPlanner.socChart.stop", "Stop")
        let unit = localize("tripPlanner.socChart.axis.distance", "km")
        let distance = SOCRouteChartFormat.distance(marker.distance, locale: locale)
        let name = marker.name.isEmpty ? "" : ", \(marker.name)"
        let atWord = localize("tripPlanner.socChart.at", "at")
        return "\(stopWord) \(marker.ordinal)\(name) \(atWord) \(distance) \(unit)"
    }
}
