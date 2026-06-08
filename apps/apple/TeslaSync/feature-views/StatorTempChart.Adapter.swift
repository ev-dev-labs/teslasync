//
//  StatorTempChart.Adapter.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  The testable projection core: a cached list of motor temperature snapshots + the user's
//  `StatorTempUnit` → the chart-ready series rows, x-axis points, and converted Normal / Warm
//  threshold lines, reproducing the web source's pipeline so the native surface plots the exact
//  same numbers as features/driving/components/drivetrain-health/StatorTempChart.tsx.
//
//  The web component is a presentational leaf fed already-display-converted `MotorChartDataPoint`s
//  by its parent (DrivetrainHealthPage L128-130 maps the SI `motor_temp_c_front` / `_rear` /
//  `inverter_temp_c` snapshots through `toTemperatureDisplay` == `convertTempFromSI`). The data
//  lines are plotted raw while the two `<ReferenceLine>`s convert SI 60 / 80 themselves — so both
//  the lines and the thresholds end up in the same display unit. The native surface owns the whole
//  pipeline: it carries the SI Celsius snapshots and converts BOTH the series and the thresholds
//  here, keeping the displayed numbers identical to the web while moving the conversion to the
//  display boundary (Phase-48 SI-canonical contract).
//
//  Deliberately free of SwiftUI so the conversion + formatting + projection + accessibility can be
//  compiled and executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref` resolved by
/// `useUnits()` (`unitPrefs.temperature`, derived from `settings.unit_of_temp`). Stored as the
/// symbol the web converter switches on (`'°C'` / `'°F'`).
public enum StatorTempUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol appended to each line name + shown as the tooltip unit (web `tempUnit`).
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol, defaulting to Celsius (the SI display
    /// default) for any unrecognized value.
    public static func from(symbol: String) -> StatorTempUnit {
        StatorTempUnit(rawValue: symbol) ?? .celsius
    }
}

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in
/// `lib/unitConversion.ts`: Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`. The backend
/// motor / inverter temperatures arrive in degrees Celsius (the SI floor the Phase-42 pipeline
/// stores), exactly the input the web parent's `toTemperatureDisplay` helper expects.
public func convertStatorTempFromSI(_ celsius: Double, to unit: StatorTempUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

// MARK: - Projector (pure, web-parity)

/// The dependency-free projection from raw snapshots to chart-ready points + rows + thresholds. A
/// faithful port of the web `motorChartData.map` (display conversion of each reading + the two
/// `toTemperatureDisplay(60 | 80)` reference lines), free of any store / bundle / SwiftUI view.
public enum StatorTempProjector {
    /// Projects the cached snapshots into the view-ready projection: each reading runs through
    /// `convertStatorTempFromSI`, the time label through `timeLabel`, and the thresholds through
    /// `thresholdLines`. Snapshot order is preserved (web `history.map`, chronological as stored).
    public static func project(
        snapshots: [StatorTempSnapshot],
        unit: StatorTempUnit,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> StatorTempProjection {
        let points = snapshots.enumerated().map { index, snapshot in
            StatorTempPoint(
                index: index,
                timeLabel: timeLabel(for: snapshot.timestamp, localeIdentifier: localeIdentifier, timeZone: timeZone),
                front: displayValue(snapshot.frontC, unit: unit),
                rearLeft: displayValue(snapshot.rearLeftC, unit: unit),
                rearRight: displayValue(snapshot.rearRightC, unit: unit)
            )
        }
        return StatorTempProjection(
            points: points,
            rows: chartRows(from: points),
            thresholds: thresholdLines(unit: unit),
            unitSymbol: unit.symbol
        )
    }

    /// Converts one optional SI reading to the display unit, preserving `nil` (web `… ? convert :
    /// null`) so the line keeps its gap rather than collapsing to zero.
    public static func displayValue(_ celsius: Double?, unit: StatorTempUnit) -> Double? {
        guard let celsius, celsius.isFinite else { return nil }
        return convertStatorTempFromSI(celsius, to: unit)
    }

    /// The flattened `(index, series)` rows for the Swift Charts grid, in plot order within each
    /// point, skipping absent readings (web `connectNulls` gap).
    public static func chartRows(from points: [StatorTempPoint]) -> [StatorTempRow] {
        points.flatMap { point in
            StatorSeries.ordered.compactMap { series -> StatorTempRow? in
                guard let value = point.value(for: series) else { return nil }
                return StatorTempRow(index: point.index, timeLabel: point.timeLabel, series: series, value: value)
            }
        }
    }

    /// The two converted threshold lines (web `toTemperatureDisplay(60 | 80)`), in draw order.
    public static func thresholdLines(unit: StatorTempUnit) -> [StatorThresholdLine] {
        StatorThreshold.allCases.map {
            StatorThresholdLine(threshold: $0, value: convertStatorTempFromSI($0.celsius, to: unit))
        }
    }

    /// Resolves the render phase from the load status + whether the chart is renderable (web
    /// `data.length > 1`). A loaded query with ≤1 snapshot is the empty state (the web `return
    /// null`, surfaced as a friendly empty panel rather than a hidden box).
    public static func resolvePhase(_ status: StatorTempLoadStatus, hasRenderableData: Bool) -> StatorTempPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasRenderableData ? .content : .empty
        }
    }

    /// The latest snapshot point (web array tail) — header summary / a11y.
    public static func latestPoint(_ points: [StatorTempPoint]) -> StatorTempPoint? {
        points.last
    }

    /// Evenly spaced x-axis tick indices (at most `maxTicks`), always including the first + last
    /// point. A long snapshot history would overlap a time label per point; thinning to a readable
    /// subset keeps the axis legible (the native counterpart of Recharts' automatic tick interval).
    public static func axisTickIndices(pointCount: Int, maxTicks: Int = 6) -> [Int] {
        guard pointCount > 1 else { return pointCount == 1 ? [0] : [] }
        let ticks = max(2, min(maxTicks, pointCount))
        guard ticks < pointCount else { return Array(0 ..< pointCount) }
        let step = Double(pointCount - 1) / Double(ticks - 1)
        var indices: [Int] = []
        for tick in 0 ..< ticks {
            let idx = Int((Double(tick) * step).rounded())
            if indices.last != idx {
                indices.append(idx)
            }
        }
        return indices
    }

    /// A locale-aware short time label for a snapshot timestamp — the native parity of the web
    /// `formatTime(ts)` (`toLocaleTimeString` with 2-digit hour + minute). An absent timestamp
    /// renders the web empty label (`s.ts ? formatTime(ts) : ''`).
    public static func timeLabel(
        for timestamp: Date?,
        localeIdentifier: String = "en_US",
        timeZone: TimeZone = .current
    ) -> String {
        guard let timestamp else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.timeZone = timeZone
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter.string(from: timestamp)
    }
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware numeric formatting for the temperature values, shared by the tooltip + the
/// accessibility summaries (bundle-free + unit-testable). Non-finite input renders an em dash.
public enum StatorTempFormat {
    /// Formats a temperature magnitude with up to one fraction digit (e.g. `61.5`, `60`).
    public static func decimal(_ value: Double, localeIdentifier: String = "en_US") -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.1f", value)
    }

    /// Formats a temperature with its display-unit symbol (e.g. `61.5 °C`), or the em dash when the
    /// reading is absent (web gap).
    public static func temperature(_ value: Double?, unit: String, localeIdentifier: String = "en_US") -> String {
        guard let value else { return "—" }
        return "\(decimal(value, localeIdentifier: localeIdentifier)) \(unit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event (testable, SwiftUI-free).
public enum StatorTempSurface {
    public static let slug = "StatorTempChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer (`(key, fallback) ->
/// String`), so they're bundle-free testable and hold no English literals themselves.
public enum StatorTempAccessibility {
    /// The chart-level summary: the title + snapshot count + the latest snapshot's three readings,
    /// or the no-data fallback when empty.
    public static func chartSummary(
        projection: StatorTempProjection,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let title = localize("drivetrain.statorTempHistory", "Stator Temperature History")
        guard projection.hasRenderableData, let latest = StatorTempProjector.latestPoint(projection.points) else {
            return "\(title): \(localize("drivetrain.statorTemp.noData", "No stator temperature history"))"
        }
        let countWord = localize("drivetrain.statorTemp.snapshots", "snapshots")
        let latestWord = localize("drivetrain.statorTemp.latest", "Latest")
        let pointValue = pointLabel(
            latest,
            unit: projection.unitSymbol,
            localize: localize,
            localeIdentifier: localeIdentifier
        )
        return "\(title): \(projection.points.count) \(countWord). \(latestWord) \(pointValue)"
    }

    /// One snapshot's VoiceOver value: "{time}: Stator X °C, Rear-Left Y °C, Rear-Right Z °C",
    /// skipping absent readings.
    public static func pointLabel(
        _ point: StatorTempPoint,
        unit: String,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let time = point.timeLabel.isEmpty ? localize("drivetrain.col.time", "Time") : point.timeLabel
        let parts = StatorSeries.ordered.compactMap { series -> String? in
            guard let value = point.value(for: series) else { return nil }
            let name = localize(series.shortKey, series.shortFallback)
            let formatted = StatorTempFormat.temperature(value, unit: unit, localeIdentifier: localeIdentifier)
            return "\(name) \(formatted)"
        }
        guard !parts.isEmpty else {
            return "\(time): \(localize("common.noData", "No data available"))"
        }
        return "\(time): \(parts.joined(separator: ", "))"
    }
}
