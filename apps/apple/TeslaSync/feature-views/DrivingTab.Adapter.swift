//
//  DrivingTab.Adapter.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  The testable projection core: the SI `DriveAnalytics*Input` DTOs → the view-ready
//  chart datasets the seven panels render. Reproduces the web source's exact behavior:
//  the `safe(v)` finite-or-zero guard, the per-chart series selection, the
//  `temp_vs_efficiency` boundary conversions (the ONLY converted chart — °C/Wh-km/km →
//  the user's display units), the `Wh/mi` vs `Wh/km` efficiency label, the
//  `daily_trend.filter(efficiency > 0)` efficiency-trend subset, the `date.slice(5)`
//  axis label, the `${hour}:00` hour label, and the scatter bubble-size scale (web
//  `ZAxis range=[30, 300]`). All pure + dependency-free so the adapter can be unit-tested
//  without a store, a bundle, or a rendered view.
//

import Foundation

// MARK: - Render phase (web shell loading / content / empty branches)

/// The mutually-exclusive render branches the surface switches over, mirroring the web
/// `isLoading` skeleton / resolved charts / "no data" empty state. The whole surface
/// resolves one phase; each chart panel additionally renders its own per-series empty
/// message inside `.content` (web parity).
public enum DriveAnalyticsPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - SI conversions (web `lib/unitConversion.ts` parity, pinned by tests)

/// Pure SI → display-unit conversions mirroring `web/src/lib/unitConversion.ts`. Kept
/// local (not routed through the KMP `Units` facade) so the projection is deterministic
/// and unit-testable without the Kotlin runtime; the parity-pin tests assert the exact
/// canonical factors so any drift from the shared converters is mechanically caught.
public enum DriveAnalyticsUnits {
    public static let metersPerKm = 1000.0
    public static let metersPerMile = 1609.344
    public static let metersPerFoot = 0.3048
    public static let kmPerMile = 1.609344

    /// Web `safe(v)`: a finite number, else `0` (never `NaN`/`Inf` reaching a chart).
    public static func safe(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// Web `convertTempFromSI(celsius, to)` — °C identity, °F linear.
    public static func convertTempFromSI(_ celsius: Double, to unit: String) -> Double {
        unit == "°F" ? celsius * 9 / 5 + 32 : celsius
    }

    /// Web `convertDistanceFromSI(meters, to)` — meters → km / mi / ft.
    public static func convertDistanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }

    /// Web efficiency boundary math: backend `Wh/km` → `Wh/mi` (×`KM_PER_MILE`) for the
    /// imperial distance unit, else unchanged.
    public static func scaleEfficiency(_ whPerKm: Double, distanceUnit unit: String) -> Double {
        unit == "mi" ? whPerKm * kmPerMile : whPerKm
    }

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`.
    public static func efficiencyLabel(distanceUnit unit: String) -> String {
        unit == "mi" ? "Wh/mi" : "Wh/km"
    }

    /// Web `tickFormatter={(h) => `${h}:00`}` for the hourly-pattern x-axis.
    public static func hourLabel(_ hour: Int) -> String {
        "\(hour):00"
    }

    /// Web `tickFormatter={(v) => v.slice(5)}` — drops the `YYYY-` prefix from an ISO date.
    public static func shortDate(_ date: String) -> String {
        date.count > 5 ? String(date.dropFirst(5)) : date
    }

    /// Web scatter `ZAxis range=[30, 300]`: linearly maps each distance to a symbol size,
    /// smallest → 30, largest → 300. A degenerate (all-equal / single) set maps to 30.
    public static func bubbleSizes(
        for distances: [Double],
        range: ClosedRange<Double> = 30 ... 300
    ) -> [Double] {
        guard let low = distances.min(), let high = distances.max() else { return [] }
        guard high > low else { return distances.map { _ in range.lowerBound } }
        let span = high - low
        let width = range.upperBound - range.lowerBound
        return distances.map { range.lowerBound + (($0 - low) / span) * width }
    }
}

// MARK: - Unit labels (web `distanceUnit` / `tempUnit` / `efficiencyUnit`)

/// The three display-unit labels the charts surface (legend names + axis units).
public struct DrivingTabDriveUnitLabels: Equatable, Sendable {
    public let distance: String
    public let temperature: String
    public let efficiency: String

    public init(units: UnitPreferences) {
        distance = units.distance
        temperature = units.temperature
        efficiency = DriveAnalyticsUnits.efficiencyLabel(distanceUnit: units.distance)
    }
}

// MARK: - Projected chart datasets (web chart `data`)

/// One histogram bar (web `{ range, count }`) for the speed / trip-distance / duration
/// distribution charts. `count` is a `Double` for Swift Charts; `range` is the category.
public struct DriveBar: Identifiable, Equatable, Sendable {
    public let id: String
    public let range: String
    public let count: Double

    public init(id: String, range: String, count: Double) {
        self.id = id
        self.range = range
        self.count = count
    }
}

/// One hourly-pattern sample (web `{ hour, drives, distance }`): a bar (drives, left axis)
/// + line (distance, right axis) keyed by hour.
public struct DriveHourlyPoint: Identifiable, Equatable, Sendable {
    public let id: Int
    public let hour: Int
    public let drives: Double
    public let distance: Double

    public init(hour: Int, drives: Double, distance: Double) {
        id = hour
        self.hour = hour
        self.drives = drives
        self.distance = distance
    }
}

/// One temperature-vs-efficiency sample, converted to display units, with the scatter
/// bubble size derived from the (converted) trip distance.
public struct DriveTempEffPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let temp: Double
    public let efficiency: Double
    public let distance: Double
    public let bubbleSize: Double

    public init(id: String, temp: Double, efficiency: Double, distance: Double, bubbleSize: Double) {
        self.id = id
        self.temp = temp
        self.efficiency = efficiency
        self.distance = distance
        self.bubbleSize = bubbleSize
    }
}

/// One daily-trend sample (web `{ date, drives, distance }`): an area (distance, left) +
/// line (drives, right). Distance is plotted raw, web parity.
public struct DriveDailyPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: String
    public let shortDate: String
    public let drives: Double
    public let distance: Double

    public init(id: String, date: String, shortDate: String, drives: Double, distance: Double) {
        self.id = id
        self.date = date
        self.shortDate = shortDate
        self.drives = drives
        self.distance = distance
    }
}

/// One efficiency-trend sample — the `daily_trend` rows with `efficiency > 0`
/// (web `effTrend = dailyTrend.filter(d => safe(d.efficiency) > 0)`). Plotted raw.
public struct DriveEffPoint: Identifiable, Equatable, Sendable {
    public let id: String
    public let date: String
    public let shortDate: String
    public let efficiency: Double

    public init(id: String, date: String, shortDate: String, efficiency: Double) {
        self.id = id
        self.date = date
        self.shortDate = shortDate
        self.efficiency = efficiency
    }
}

// MARK: - Projection (pure, web-parity)

/// The view-ready projection of all seven charts plus the active unit labels. Built once
/// per snapshot by `make(from:units:)`; the view switches on `DrivingTabModel.phase` and
/// renders each dataset (or its per-series empty message).
public struct DrivingTabProjection: Equatable, Sendable {
    public let speedBars: [DriveBar]
    public let distanceBars: [DriveBar]
    public let hourly: [DriveHourlyPoint]
    public let tempEff: [DriveTempEffPoint]
    public let dailyTrend: [DriveDailyPoint]
    public let durationBars: [DriveBar]
    public let effTrend: [DriveEffPoint]
    public let labels: DrivingTabDriveUnitLabels

    public init(
        speedBars: [DriveBar],
        distanceBars: [DriveBar],
        hourly: [DriveHourlyPoint],
        tempEff: [DriveTempEffPoint],
        dailyTrend: [DriveDailyPoint],
        durationBars: [DriveBar],
        effTrend: [DriveEffPoint],
        labels: DrivingTabDriveUnitLabels
    ) {
        self.speedBars = speedBars
        self.distanceBars = distanceBars
        self.hourly = hourly
        self.tempEff = tempEff
        self.dailyTrend = dailyTrend
        self.durationBars = durationBars
        self.effTrend = effTrend
        self.labels = labels
    }

    /// Whether any of the seven charts has at least one sample.
    public var hasAny: Bool {
        !(
            speedBars.isEmpty && distanceBars.isEmpty && hourly.isEmpty && tempEff.isEmpty
                && dailyTrend.isEmpty && durationBars.isEmpty && effTrend.isEmpty
        )
    }

    /// An all-empty projection carrying only the unit labels (no payload yet).
    public static func empty(units: UnitPreferences) -> DrivingTabProjection {
        DrivingTabProjection(
            speedBars: [],
            distanceBars: [],
            hourly: [],
            tempEff: [],
            dailyTrend: [],
            durationBars: [],
            effTrend: [],
            labels: DrivingTabDriveUnitLabels(units: units)
        )
    }

    /// Projects the SI payload into the seven view-ready datasets in display units.
    public static func make(from input: DriveAnalyticsInput?, units: UnitPreferences) -> DrivingTabProjection {
        let labels = DrivingTabDriveUnitLabels(units: units)
        guard let input else { return .empty(units: units) }

        let hourly = input.hourlyPattern.map { point in
            DriveHourlyPoint(
                hour: point.hour,
                drives: DriveAnalyticsUnits.safe(point.drives),
                distance: DriveAnalyticsUnits.safe(point.distance)
            )
        }
        let dailyTrend = input.dailyTrend.map { row in
            DriveDailyPoint(
                id: row.date,
                date: row.date,
                shortDate: DriveAnalyticsUnits.shortDate(row.date),
                drives: DriveAnalyticsUnits.safe(row.drives),
                distance: DriveAnalyticsUnits.safe(row.distance)
            )
        }
        let effTrend = input.dailyTrend.compactMap { row -> DriveEffPoint? in
            let efficiency = DriveAnalyticsUnits.safe(row.efficiency ?? 0)
            guard efficiency > 0 else { return nil }
            return DriveEffPoint(
                id: row.date,
                date: row.date,
                shortDate: DriveAnalyticsUnits.shortDate(row.date),
                efficiency: efficiency
            )
        }
        return DrivingTabProjection(
            speedBars: bars(from: input.speedDistribution),
            distanceBars: bars(from: input.distanceDistribution),
            hourly: hourly,
            tempEff: tempEffPoints(from: input.tempVsEfficiency, units: units),
            dailyTrend: dailyTrend,
            durationBars: bars(from: input.durationDistribution),
            effTrend: effTrend,
            labels: labels
        )
    }

    /// Resolves the surface render phase. The skeleton shows only on the initial fetch
    /// (no charts yet); cached charts stay visible behind a refresh/failure, with the
    /// freshness chip + banner reflecting staleness — mirroring the web shell.
    public static func resolvePhase(
        _ status: DriveAnalyticsLoadStatus,
        projection: DrivingTabProjection
    ) -> DriveAnalyticsPhase {
        switch status {
        case .loading:
            projection.hasAny ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasAny ? .content : .empty
        case let .failed(message):
            projection.hasAny ? .content : .error(message)
        }
    }

    private static func bars(from input: [DriveDistributionBinInput]) -> [DriveBar] {
        input.enumerated().map { index, bin in
            DriveBar(id: "\(index)-\(bin.range)", range: bin.range, count: Double(bin.count))
        }
    }

    private static func tempEffPoints(
        from input: [DriveTempEfficiencyInput],
        units: UnitPreferences
    ) -> [DriveTempEffPoint] {
        let distances = input.map { row in
            DriveAnalyticsUnits.convertDistanceFromSI(
                DriveAnalyticsUnits.safe(row.distance) * 1000,
                to: units.distance
            )
        }
        let sizes = DriveAnalyticsUnits.bubbleSizes(for: distances)
        return input.enumerated().map { index, row in
            DriveTempEffPoint(
                id: "\(index)",
                temp: DriveAnalyticsUnits.convertTempFromSI(DriveAnalyticsUnits.safe(row.temp), to: units.temperature),
                efficiency: DriveAnalyticsUnits.scaleEfficiency(
                    DriveAnalyticsUnits.safe(row.efficiency),
                    distanceUnit: units.distance
                ),
                distance: distances[index],
                bubbleSize: sizes[index]
            )
        }
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver value strings for the chart panels. Pure + public so the spoken
/// content can be unit-tested without rendering; the view passes pre-localized nouns so no
/// English literals live here.
public enum DriveAnalyticsAccessibility {
    /// "{n} {rangesNoun}, {total} {totalNoun}" for a histogram, or the empty fallback.
    public static func distributionSummary(
        bars: [DriveBar],
        rangesNoun: String,
        totalNoun: String,
        emptyFallback: String
    ) -> String {
        guard !bars.isEmpty else { return emptyFallback }
        let total = Int(bars.reduce(0) { $0 + $1.count }.rounded())
        return "\(bars.count) \(rangesNoun), \(total) \(totalNoun)"
    }

    /// "{count} {noun}" for a series, or the empty fallback when there is nothing to read.
    public static func countSummary(_ count: Int, noun: String, emptyFallback: String) -> String {
        count > 0 ? "\(count) \(noun)" : emptyFallback
    }
}
