//
//  TemperatureSection.Projector.swift
//  TeslaSync — P4 feature view · 0150 · TemperatureSection (Apple)
//
//  The pure (Foundation-only) computational core for the drive-detail
//  "Temperatures" surface: the SI→display projector, the render-phase resolver, the
//  `fmtNumber` / `fmtInt`-parity number formatting, the diagnostics slug, and the
//  VoiceOver summary. Split out of TemperatureSection.Adapter.swift (which holds the
//  value-typed model) to keep each file within the lint budget; both are
//  dependency-free so every number can be pinned by unit tests without a bundle.
//

import Foundation

// MARK: - Projector (pure, web-parity)

/// The dependency-free projection from SI samples + the display unit to the
/// view-ready `TempSectionProjection`. A faithful port of the web `chartData` /
/// `stats` derivation: convert each sample to the display unit, collect per-series
/// present values, average them, roll up the climate status, summarize the fan, and
/// resolve presence.
public enum TempSectionProjector {
    /// Projects the SI samples into the converted, view-ready projection.
    public static func project(
        samples: [TempSectionSample],
        unit: TempSectionUnit
    ) -> TempSectionProjection {
        let points = samples.enumerated().map { index, sample in
            TempSectionPoint(
                index: index,
                time: sample.time,
                outside: sample.outsideC.map { convertTempSectionFromSI($0, to: unit) },
                inside: sample.insideC.map { convertTempSectionFromSI($0, to: unit) },
                driver: sample.driverC.map { convertTempSectionFromSI($0, to: unit) },
                passenger: sample.passengerC.map { convertTempSectionFromSI($0, to: unit) }
            )
        }

        var presentSeries: [TempSectionSeries] = []
        var averages: [TempSectionSeries: Double] = [:]
        for series in TempSectionSeries.ordered {
            let values = points.compactMap { $0.value(for: series) }
            guard !values.isEmpty else { continue }
            presentSeries.append(series)
            averages[series] = mean(values)
        }

        let climateOnCount = samples.count(where: { $0.climateOn == true })
        let climateOffCount = samples.count(where: { $0.climateOn == false })
        let climate = climateStatus(onCount: climateOnCount, offCount: climateOffCount)

        let fanValues = samples.compactMap(\.fanStatus)
        let avgFan = fanValues.isEmpty ? nil : mean(fanValues)
        let maxFan = fanValues.max()

        return TempSectionProjection(
            points: points,
            presentSeries: presentSeries,
            averages: averages,
            climate: climate,
            avgFan: avgFan,
            maxFan: maxFan,
            unitSymbol: unit.symbol
        )
    }

    /// The web climate rollup
    /// (`onCount > 0 ? (onCount >= offCount ? 'On' : 'Mostly Off') : (offCount > 0 ?
    /// 'Off' : null)`).
    public static func climateStatus(onCount: Int, offCount: Int) -> TempSectionClimate? {
        if onCount > 0 {
            return onCount >= offCount ? .on : .mostlyOff
        }
        return offCount > 0 ? .off : nil
    }

    /// The arithmetic mean of a non-empty array (web `reduce(a + b, 0) / length`).
    /// Returns `0` for an empty input; callers gate on presence before calling.
    public static func mean(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        return values.reduce(0, +) / Double(values.count)
    }
}

// MARK: - Render phase

/// What the surface should render. The web source distinguishes only content vs the
/// "no temperature telemetry" empty state; the loading / error envelope around it
/// (prompt P4 states) is supplied by the bound source, mirroring the web parent
/// page's `isLoading` / error wiring on the drive-detail page.
public enum TempSectionPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drive query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum TempSectionLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data
/// banner so a cached trace is clearly labeled while reconnecting / offline.
public enum TempSectionConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

public extension TempSectionProjector {
    /// Resolves the render phase from the bound load status + whether the projection
    /// cleared the web content gate. Cached content stays visible across refresh /
    /// transient failures so an offline or stale pod still shows the last-known trace.
    static func resolvePhase(_ status: TempSectionLoadStatus, hasContent: Bool) -> TempSectionPhase {
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
/// accessibility summaries — the port of `fmtNumber` / `fmtInt` from
/// lib/numberFormat.ts (locale-grouped, half-away-from-zero). Bundle-free + testable.
public enum TempSectionFormat {
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

    /// `fmtInt(v)` — grouped integer (web `fmtNumber(v, 0)`), for the average fan.
    public static func int(_ value: Double, localeIdentifier: String = "en_US") -> String {
        number(value, decimals: 0, localeIdentifier: localeIdentifier)
    }

    /// A bare numeric string with no grouping, mirroring the web `${stats.maxFanSpeed}`
    /// template interpolation (a plain JS number `toString`), used for the max fan.
    public static func plain(_ value: Double, localeIdentifier: String = "en_US") -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 3
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? "\(safe)"
    }

    /// A converted temperature value with its unit symbol appended and no separating
    /// space (web `${fmtNumber(value)}${tempUnit}` → e.g. "21.50°C").
    public static func temperature(
        _ value: Double,
        symbol: String,
        decimals: Int = 2,
        localeIdentifier: String = "en_US"
    ) -> String {
        "\(number(value, decimals: decimals, localeIdentifier: localeIdentifier))\(symbol)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable).
public enum TempSectionSurface {
    public static let slug = "TemperatureSection"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`), so they're bundle-free testable. The chart carries
/// no data table (web `chart-a11y:no-table`); this summary + the per-tile labels are
/// the spoken parity.
public enum TempSectionAccessibility {
    /// The chart-level summary: the title followed by each present series' average
    /// (e.g. "Temperatures: Outside 21.50 °C, Inside 22.00 °C"), or the no-data
    /// sentence when empty.
    public static func chartSummary(
        projection: TempSectionProjection,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let title = localize("driveDetail.temperatures", "Temperatures")
        guard projection.hasContent else {
            let empty = localize(
                "driveDetail.noTemperatureData",
                "No temperature telemetry is available for this drive."
            )
            return "\(title): \(empty)"
        }
        let parts = projection.presentSeries.compactMap { series -> String? in
            guard let average = projection.average(for: series) else { return nil }
            let name = localize(series.nameKey, series.nameFallback)
            let value = TempSectionFormat.number(average, localeIdentifier: localeIdentifier)
            return "\(name) \(value) \(projection.unitSymbol)"
        }
        return "\(title): \(parts.joined(separator: ", "))"
    }
}
