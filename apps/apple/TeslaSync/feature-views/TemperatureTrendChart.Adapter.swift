//
//  TemperatureTrendChart.Adapter.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  Pure (Foundation-only) projection core for the "Temperature Trend" surface — the
//  faithful port of the outside-temperature-per-recent-drive line chart in
//  features/driving/components/drivetrain-health/TemperatureTrendChart.tsx. The web
//  component receives `data: ChartDataPoint[]` (date + outsideTemp) from
//  DrivetrainHealthPage, which builds each row as `outsideTemp: d.outsideTempAvgC ??
//  null` — i.e. the RAW SI degrees-Celsius the Phase-42 pipeline stores. The chart's
//  two `<ReferenceLine>`s convert their 35 °C / 0 °C thresholds with
//  `toTemperatureDisplay`, and the Y-axis is labeled with the display unit symbol.
//
//  Parity decision (documented — not a silent drift): the web line plots the raw
//  Celsius values while the axis label + reference lines are in the user's display
//  unit, which is a latent °F scale mismatch in the web source. Following the repo's
//  SI-cutover policy ("read SI from the API, convert only at the display boundary")
//  and to agree with the reference lines, this port converts the line values to the
//  display unit as well. In °C the conversion is the identity, so the output is byte-
//  identical to the web; in °F it is the evidently-intended, self-consistent result.
//
//  Dependency-free so the conversion + projection + phase + accessibility can compile
//  and run on a plain host and be pinned by unit tests without a bundle or a view.
//

import Foundation

// MARK: - Temperature conversion (ported 1:1 from web lib/unitConversion.ts)

/// Temperature converter ported 1:1 from `convertTempFromSI(celsius, to)` in
/// `lib/unitConversion.ts`: Celsius passes through; Fahrenheit is `c * 9 / 5 + 32`.
/// The backend `outsideTempAvgC` arrives in degrees Celsius (the SI floor the
/// Phase-42 pipeline stores), exactly the input the web `toTemperatureDisplay`
/// helper expects.
func convertTemperatureTrendFromSI(_ celsius: Double, to unit: TemperatureTrendUnit) -> Double {
    switch unit {
    case .celsius:
        celsius
    case .fahrenheit:
        celsius * 9 / 5 + 32
    }
}

/// A finite-number guard: a finite reading passes through, anything else (NaN / ±∞ /
/// absent) collapses to `nil` so the chart renders a gap rather than a spurious point
/// — mirroring how Recharts skips `null` / non-finite `outsideTemp` values.
func temperatureTrendSafe(_ value: Double?) -> Double? {
    guard let value, value.isFinite else { return nil }
    return value
}

// MARK: - Display unit (web `unitPrefs.temperature`)

/// The user's temperature display preference. Mirrors the web `TemperatureUnitPref`
/// resolved by `useUnits()` (`unitPrefs.temperature`, derived from
/// `settings.unit_of_temperature`). Stored as the symbol the web converter switches on.
public enum TemperatureTrendUnit: String, Sendable, Equatable, CaseIterable {
    case celsius = "°C"
    case fahrenheit = "°F"

    /// The symbol shown as the Y-axis label + cell subtitle (`°C` / `°F`), matching
    /// the web `tempUnit`.
    public var symbol: String {
        rawValue
    }

    /// Resolves the unit from the web preference symbol (`'°C'` / `'°F'`), defaulting
    /// to Celsius for any unrecognized value (the SI display default).
    public static func from(symbol: String) -> TemperatureTrendUnit {
        TemperatureTrendUnit(rawValue: symbol) ?? .celsius
    }
}

// MARK: - Sample input (web `ChartDataPoint` subset)

/// One recent-drive sample, narrowed to the fields the web `TemperatureTrendChart`
/// reads off `ChartDataPoint`: the preformatted short date label (web
/// `formatDateShort(d.startTs)`) and the average outside temperature in degrees
/// Celsius (web `d.outsideTempAvgC ?? null`, an SI value, `nil` when the drive has
/// no ambient reading). The bound source maps the shared drives query into these so
/// the projection stays dependency-free and testable.
public struct TemperatureTrendSample: Sendable, Equatable {
    /// The x-axis label for the drive (web `date`, already short-formatted upstream).
    public var date: String
    /// The drive's average ambient temperature in °C (SI, web `outsideTempAvgC`), or
    /// `nil` when absent.
    public var outsideTempC: Double?

    public init(date: String, outsideTempC: Double?) {
        self.date = date
        self.outsideTempC = outsideTempC
    }
}

// MARK: - Projected point (one plotted drive)

/// One projected drive point: a stable index (the x position, so duplicate date
/// labels for two drives on the same day never collide the way a categorical string
/// axis would), the date label, and the display-unit temperature (`nil` → a line
/// gap). The native parity of one entry the web `<Line dataKey="outsideTemp">` plots.
public struct TemperatureTrendPoint: Sendable, Equatable, Identifiable {
    /// The stable plot index / x value (drive order, oldest → newest).
    public var index: Int
    /// The short date label shown on the x-axis tick + tooltip (web `date`).
    public var date: String
    /// The outside temperature converted to the display unit, or `nil` when the drive
    /// had no ambient reading (rendered as a gap, like the web `null`).
    public var outsideTemp: Double?

    public var id: Int {
        index
    }

    public init(index: Int, date: String, outsideTemp: Double?) {
        self.index = index
        self.date = date
        self.outsideTemp = outsideTemp
    }
}

// MARK: - Threshold (web `<ReferenceLine>`)

/// Which annotated reference line a threshold is — the web Warm Zone (35 °C) and
/// Freezing (0 °C) markers. Carries the i18n key/fallback for its label and the chart
/// color role so the view stays token-driven.
public enum TemperatureTrendThresholdKind: String, Sendable, Equatable, CaseIterable, Identifiable {
    case warmZone
    case freezing

    public var id: String {
        rawValue
    }

    /// The source SI threshold in °C (web `35` / `0`), converted to the display unit
    /// at projection time.
    public var celsius: Double {
        switch self {
        case .warmZone: 35
        case .freezing: 0
        }
    }

    /// The i18n key for the line's label (web `<ReferenceLine label value>`).
    public var labelKey: String {
        switch self {
        case .warmZone: "drivetrain.warmZone"
        case .freezing: "drivetrain.freezing"
        }
    }

    /// The web English fallback for `labelKey`.
    public var labelFallback: String {
        switch self {
        case .warmZone: "Warm Zone"
        case .freezing: "Freezing"
        }
    }
}

/// One resolved reference line: its kind + the threshold already converted to the
/// display unit (web `toTemperatureDisplay(35)` / `toTemperatureDisplay(0)`).
public struct TemperatureTrendThreshold: Sendable, Equatable, Identifiable {
    public var kind: TemperatureTrendThresholdKind
    /// The threshold value in the display unit (the chart `y` position).
    public var value: Double

    public var id: String {
        kind.rawValue
    }

    public init(kind: TemperatureTrendThresholdKind, value: Double) {
        self.kind = kind
        self.value = value
    }
}

// MARK: - Projection (the adapter output the view renders)

/// The fully-computed projection the view renders: the plotted drive points, the two
/// converted reference-line thresholds, the display-unit symbol shown on the Y axis,
/// and `hasTrend` — the web `data.length <= 1` guard that decides whether a trend can
/// be drawn at all (the web returns `null` for ≤ 1 point; the native surface renders
/// the empty state so the panel is never a blank box).
public struct TemperatureTrendProjection: Sendable, Equatable {
    public var points: [TemperatureTrendPoint]
    public var thresholds: [TemperatureTrendThreshold]
    public var unitSymbol: String
    /// Web `data.length > 1`: at least two drives, so a trend line is meaningful.
    public var hasTrend: Bool

    public init(
        points: [TemperatureTrendPoint],
        thresholds: [TemperatureTrendThreshold],
        unitSymbol: String,
        hasTrend: Bool
    ) {
        self.points = points
        self.thresholds = thresholds
        self.unitSymbol = unitSymbol
        self.hasTrend = hasTrend
    }

    /// The drive points that carry a temperature reading (the ones actually plotted as
    /// line + dot marks; the others render as gaps).
    public var plottablePoints: [TemperatureTrendPoint] {
        points.filter { $0.outsideTemp != nil }
    }

    /// The most recent plotted reading (web array tail) — header summary / a11y.
    public var latestReading: TemperatureTrendPoint? {
        plottablePoints.last
    }

    /// The threshold of a given kind, if present.
    public func threshold(_ kind: TemperatureTrendThresholdKind) -> TemperatureTrendThreshold? {
        thresholds.first { $0.kind == kind }
    }
}

// MARK: - Projector (port of the web component's render data)

/// Pure functions that turn cached drive samples into the chart-ready projection — a
/// 1:1 port of the data the web `TemperatureTrendChart` plots, so both platforms show
/// identical trends. No store, no bundle, no SwiftUI.
public enum TemperatureTrendProjector {
    /// Builds the display-unit drive points (one per sample, oldest → newest), each
    /// converted via `temperatureTrendSafe` → `convertTemperatureTrendFromSI`.
    public static func points(
        from samples: [TemperatureTrendSample],
        unit: TemperatureTrendUnit
    ) -> [TemperatureTrendPoint] {
        samples.enumerated().map { index, sample in
            let display = temperatureTrendSafe(sample.outsideTempC)
                .map { convertTemperatureTrendFromSI($0, to: unit) }
            return TemperatureTrendPoint(index: index, date: sample.date, outsideTemp: display)
        }
    }

    /// The two reference-line thresholds, converted to the display unit (web
    /// `toTemperatureDisplay(35)` Warm Zone and `toTemperatureDisplay(0)` Freezing).
    public static func thresholds(unit: TemperatureTrendUnit) -> [TemperatureTrendThreshold] {
        TemperatureTrendThresholdKind.allCases.map { kind in
            TemperatureTrendThreshold(
                kind: kind,
                value: convertTemperatureTrendFromSI(kind.celsius, to: unit)
            )
        }
    }

    /// Web `data.length <= 1 → return null`: a trend needs at least two drives.
    public static func hasTrend(sampleCount: Int) -> Bool {
        sampleCount > 1
    }

    /// Projects cached samples into the render model: the plotted points, the converted
    /// thresholds, the display-unit symbol, and the `hasTrend` content/empty split.
    public static func project(
        samples: [TemperatureTrendSample],
        unit: TemperatureTrendUnit
    ) -> TemperatureTrendProjection {
        TemperatureTrendProjection(
            points: points(from: samples, unit: unit),
            thresholds: thresholds(unit: unit),
            unitSymbol: unit.symbol,
            hasTrend: hasTrend(sampleCount: samples.count)
        )
    }

    /// Resolves the render phase from the bound load status + whether a trend can be
    /// drawn (web `data.length > 1 ? chart : null`, widened to the load envelope).
    public static func resolvePhase(_ status: TemperatureTrendLoadStatus, hasTrend: Bool) -> TemperatureTrendPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasTrend ? .content : .empty
        }
    }
}

// MARK: - Render phase (web content/empty split, plus the load envelope)

/// What the surface should render. The web source only distinguishes content-vs-null
/// (`data.length <= 1`); the loading / error envelope around it (prompt P4 states) is
/// supplied by the bound source, mirroring the DrivetrainHealthPage's `isLoading` /
/// error wiring on the drives query.
public enum TemperatureTrendPhase: Sendable, Equatable {
    case loading
    case content
    case empty
    case error(String)
}

/// The bound source's load status for the drives query (web `isLoading` / resolved /
/// failure), projected into a phase by `resolvePhase`.
public enum TemperatureTrendLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner
/// so a cached trend is clearly labeled while reconnecting / offline.
public enum TemperatureTrendConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Number formatting (pure, bundle-free)

/// Locale-aware temperature formatting shared by the chart axis, the tooltip, and the
/// accessibility summaries (bundle-free + unit-testable).
public enum TemperatureTrendFormat {
    /// Formats a temperature magnitude with up to one fraction digit (e.g. `21.5`,
    /// `32`). Non-finite input renders an em dash (never "nan").
    public static func decimal(_ value: Double, localeIdentifier: String = "en_US") -> String {
        guard value.isFinite else { return "—" }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 1
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    /// Formats a temperature with its display-unit symbol (e.g. `21.5 °C`). A `nil`
    /// reading renders the em dash (web `'—'`).
    public static func temperature(_ value: Double?, unit: String, localeIdentifier: String = "en_US") -> String {
        guard let value else { return "—" }
        return "\(decimal(value, localeIdentifier: localeIdentifier)) \(unit)"
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the
/// dependency-free core so it is reachable from the projection's unit tests.
public enum TemperatureTrendSurface {
    public static let slug = "TemperatureTrendChart"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings through an injected localizer
/// (`(key, fallback) -> String`) + a locale identifier, so they are bundle-free
/// testable, exactly like the view's P1/S10 facade.
public enum TemperatureTrendAccessibility {
    /// The chart-level summary: title + plotted-drive count + the latest reading, or
    /// the no-data fallback when there is no trend.
    public static func chartSummary(
        projection: TemperatureTrendProjection,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        let title = localize("drivetrain.tempHistory", "Temperature Trend")
        guard projection.hasTrend, let latest = projection.latestReading else {
            return "\(title): \(localize("common.noData", "No data available"))"
        }
        let drives = localize("drivetrain.temp.driveCount", "drives")
        let latestWord = localize("drivetrain.temp.latest", "Latest")
        let value = pointValue(
            latest,
            unit: projection.unitSymbol,
            localize: localize,
            localeIdentifier: localeIdentifier
        )
        return "\(title): \(projection.plottablePoints.count) \(drives). \(latestWord) \(value)"
    }

    /// One drive's VoiceOver value: "{date}: {temp} {unit}", or "{date}: {noReading}"
    /// when that drive has no ambient temperature.
    public static func pointValue(
        _ point: TemperatureTrendPoint,
        unit: String,
        localize: (String, String) -> String,
        localeIdentifier: String = "en_US"
    ) -> String {
        guard let value = point.outsideTemp else {
            return "\(point.date): \(localize("drivetrain.temp.noReading", "no reading"))"
        }
        let formatted = TemperatureTrendFormat.temperature(value, unit: unit, localeIdentifier: localeIdentifier)
        let outside = localize("drivetrain.outsideTemp", "Outside Temp")
        return "\(point.date): \(outside) \(formatted)"
    }
}
