//
//  TirePressureSection.Projector.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  The pure (Foundation-only) computational core for the drive-detail "Tire Pressure
//  During Drive" surface: the SI→display projector, the render-phase resolver, the
//  `fmtNumber`-parity number / range formatting, the diagnostics slug, and the
//  VoiceOver summary. Split out of TirePressureSection.Adapter.swift (which holds the
//  value-typed model) to keep each file within the lint budget; both are
//  dependency-free so every number can be pinned by unit tests without a bundle.
//

import Foundation

// MARK: - Projector (pure, web-parity)

/// The dependency-free projection from SI samples + the display unit to the
/// view-ready `TPSectionProjection`. A faithful port of the web `chartData` /
/// `stats.hasTirePressure` derivation: convert each sample to the display unit,
/// collect the per-wheel present values, take each present wheel's min/max range
/// (filtering `v > 0`), and gate line-presence on a non-null reading.
public enum TPSectionProjector {
    /// Projects the SI samples into the converted, view-ready projection.
    public static func project(
        samples: [TPSectionSample],
        unit: TPSectionUnit
    ) -> TPSectionProjection {
        let points = samples.enumerated().map { index, sample in
            TPSectionPoint(
                index: index,
                time: sample.time,
                frontLeft: sample.frontLeftPa.map { convertTirePressureFromSI($0, to: unit) },
                frontRight: sample.frontRightPa.map { convertTirePressureFromSI($0, to: unit) },
                rearLeft: sample.rearLeftPa.map { convertTirePressureFromSI($0, to: unit) },
                rearRight: sample.rearRightPa.map { convertTirePressureFromSI($0, to: unit) }
            )
        }

        var presentWheels: [TPSectionWheel] = []
        var ranges: [TPSectionWheel: TPSectionRange] = [:]
        for wheel in TPSectionWheel.ordered {
            // Line presence (web `chartData.some(d => d.tireFl !== null)`): any
            // non-null reading draws the line, regardless of sign.
            let hasReading = points.contains { $0.value(for: wheel) != nil }
            guard hasReading else { continue }
            presentWheels.append(wheel)
            // Range (web `tpVals`): min/max over the positive readings only.
            if let range = range(of: points.compactMap { $0.value(for: wheel) }) {
                ranges[wheel] = range
            }
        }

        return TPSectionProjection(
            points: points,
            presentWheels: presentWheels,
            ranges: ranges,
            unitSymbol: unit.symbol
        )
    }

    /// The web `tpVals` reduction: the min/max over the strictly-positive values, or
    /// `nil` when none qualify (`vals.length > 0 ? … : null`, `filter(v > 0)`).
    public static func range(of values: [Double]) -> TPSectionRange? {
        let positive = values.filter { $0 > 0 }
        guard let lo = positive.min(), let hi = positive.max() else { return nil }
        return TPSectionRange(min: lo, max: hi)
    }
}

// MARK: - Render phase

/// What the surface should render. The web source distinguishes only content vs the
/// "No telemetry data available" empty state; the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the web parent
/// page's `isLoading` / error wiring on the drive-detail page.
public enum TPSectionPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum TPSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trace is clearly labeled while reconnecting / offline.
public enum TPSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension TPSectionProjector {
    /// Resolves the render phase from the bound load status + whether the projection
    /// cleared the web content gate. Cached content stays visible across refresh /
    /// transient failures so an offline or stale pod still shows the last-known trace.
    static func resolvePhase(_ status: TPSectionLoadStatus, hasContent: Bool) -> TPSectionPhase {
        switch status {
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            hasContent ? .content : .empty
        case let .failed(message):
            hasContent ? .content : .error(message)
        }
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware numeric formatting shared by the tiles, the tooltip, and the
/// accessibility summaries — the port of `fmtNumber` from lib/numberFormat.ts
/// (locale-grouped, half-away-from-zero, default precision 2). Bundle-free + testable.
public enum TPSectionFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped. The web
    /// tiles call `fmtNumber(value)` at the global precision (default 2).
    public static func number(_ value: Double, decimals: Int = 2, localeIdentifier: String = "en_US") -> String {
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

    /// One wheel's tile value: the converted min/max joined by an en dash with the
    /// unit symbol appended after a space — the 1:1 port of the web
    /// `${fmtNumber(tp.min)}–${fmtNumber(tp.max)} ${pressureUnit}`.
    public static func range(
        _ range: TPSectionRange,
        symbol: String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let lo = number(range.min, localeIdentifier: localeIdentifier)
        let hi = number(range.max, localeIdentifier: localeIdentifier)
        return "\(lo)–\(hi) \(symbol)"
    }

    /// A single converted value with its unit symbol appended after a space (tooltip
    /// rows, web `${fmtNumber(value)} ${pressureUnit}`).
    public static func value(
        _ value: Double,
        symbol: String,
        localeIdentifier: String = "en_US"
    ) -> String {
        "\(number(value, localeIdentifier: localeIdentifier)) \(symbol)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum TPSectionSurface {
    public static let slug = "TirePressureSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`), so they're bundle-free testable. The chart carries
/// no data table (web `chart-a11y:no-table`); this summary + the per-tile labels are
/// the spoken parity.
public enum TPSectionAccessibility {
    /// The chart-level summary: the title followed by each present wheel's min/max
    /// range (e.g. "Tire Pressure During Drive: Front Left 289.50–292.00 kPa"), or the
    /// no-data sentence when empty.
    public static func chartSummary(
        projection: TPSectionProjection,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let title = localize("driveDetail.tirePressure", "Tire Pressure During Drive")
        guard projection.hasContent else {
            let empty = localize("driveDetail.noChartData", "No telemetry data available")
            return "\(title): \(empty)"
        }
        let parts = projection.presentWheels.compactMap { wheel -> String? in
            guard let range = projection.range(for: wheel) else { return nil }
            let name = localize(wheel.tileLabelKey, wheel.tileLabelFallback)
            let value = TPSectionFormat.range(
                range,
                symbol: projection.unitSymbol,
                localeIdentifier: localeIdentifier
            )
            return "\(name) \(value)"
        }
        return "\(title): \(parts.joined(separator: ", "))"
    }
}
