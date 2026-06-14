//
//  YearReviewWidget.Adapter.swift
//  TeslaSync — P4 dashboard widget · 0118 · YearReviewWidget (Apple)
//
//  Pure (Foundation-only) projection: cached `YearReviewDTO` + `YearReviewUnitPrefs` → display
//  strings, reproducing the web source's numeric pipeline VERBATIM so the native surface shows the
//  exact same values as features/dashboard/widgets/YearReviewWidget.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web lib/constants.ts + lib/unitConversion.ts)

private enum YearReviewConstants {
    /// `UNITS.KM_TO_MI` from lib/constants.ts. Used by the web widget to turn the API's kilometres
    /// into the codebase's internal miles before display conversion.
    static let kmToMile = 0.621371

    /// Seconds per hour — the `SECONDS_PER_HOUR` factor in `convertSpeedFromSI`.
    static let secondsPerHour = 3600.0

    /// Minutes per hour — the web widget's `/ 60` driving-time divisor.
    static let minutesPerHour = 60.0
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts —
/// a divide by the unit's metres-per-unit factor.
///
/// The web widget feeds this function a value already expressed in miles
/// (`total_distance_km * KM_TO_MI`), matching the source's `displayDistance` computation exactly.
/// We reproduce that call chain verbatim for cross-platform value parity rather than "correcting" it,
/// so a user with the web and native dashboards open side by side sees identical numbers.
func convertYearReviewDistanceFromSI(_ value: Double, to unit: YearReviewDistanceUnit) -> Double {
    let safe = value.isFinite ? value : 0
    return safe / unit.metersPerUnit
}

/// Speed converter ported 1:1 from `convertSpeedFromSI(mps, to)` in lib/unitConversion.ts —
/// `(value * SECONDS_PER_HOUR) / metresPerUnit`. As with distance, the web widget feeds this a value
/// already scaled by `KM_TO_MI` (`fastest_speed_kmh * KM_TO_MI`); reproduced verbatim for parity.
func convertYearReviewSpeedFromSI(_ value: Double, to unit: YearReviewSpeedUnit) -> Double {
    let safe = value.isFinite ? value : 0
    switch unit {
    case .kilometersPerHour:
        return (safe * YearReviewConstants.secondsPerHour) / YearReviewDistanceUnit.kilometers.metersPerUnit
    case .milesPerHour:
        return (safe * YearReviewConstants.secondsPerHour) / YearReviewDistanceUnit.miles.metersPerUnit
    }
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` / `fmtInt`
/// (`Number.toLocaleString`).
public enum YearReviewFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from
    /// zero to match `Number.toLocaleString`'s default `halfExpand`.
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

    /// `fmtInt(v)` — `fmtNumber(v, 0)`.
    public static func integer(_ value: Int, localeIdentifier: String = "en_US") -> String {
        number(Double(value), decimals: 0, localeIdentifier: localeIdentifier)
    }
}

// MARK: - Busiest month (web `MONTH_NAMES` + reduce)

/// Resolves the abbreviated name of the busiest driving month. Pure + public so the parity logic is
/// unit-tested without rendering. Mirrors the web widget's `busiestMonth` memo: pick the month with
/// the most drives (first wins on ties, as `reduce`'s strict `>` does), then map its 1-based index to
/// a short month symbol. Locale-aware standalone symbols (en_US → "Jan"…"Dec") match the web
/// `MONTH_NAMES` array while staying internationalised.
public enum YearReviewMonth {
    /// The em-dash placeholder the web returns when there is no monthly data / a bad index. // parity:allow ui
    public static let placeholder = "—" // parity:allow ui

    public static func busiest(_ stats: [YearReviewMonthlyStat], localeIdentifier: String = "en_US") -> String {
        guard let first = stats.first else { return placeholder } // parity:allow ui
        var best = first
        for stat in stats.dropFirst() where stat.drives > best.drives {
            best = stat
        }
        let index = (best.month - 1) % 12
        let symbols = shortMonthSymbols(localeIdentifier: localeIdentifier)
        guard index >= 0, index < symbols.count else { return placeholder } // parity:allow ui
        return symbols[index]
    }

    private static func shortMonthSymbols(localeIdentifier: String) -> [String] {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        return formatter.shortStandaloneMonthSymbols ?? formatter.shortMonthSymbols ?? []
    }
}

// MARK: - Projected stat item (web `StatGridItem` / `StatCard`)

/// One projected stat tile: a localized label, a formatted value, an optional unit suffix and an SF
/// Symbol. Mirrors the web `StatGridItem` (`label`, `value`, `unit`, `icon`).
public struct YearReviewStatItem: Identifiable, Equatable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let unit: String?
    public let systemImage: String

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        unit: String?,
        systemImage: String
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.unit = unit
        self.systemImage = systemImage
    }

    /// The resolved (localized) label for display + accessibility.
    public var label: String {
        YearReviewStrings.string(labelKey, labelFallback)
    }
}

// MARK: - Projection

/// The fully-projected widget content for every layout: the core stats (standard), the extra wide
/// stats, the compact big-number value and its unit symbol, plus the recap year. Computed once per
/// snapshot by the model.
public struct YearReviewProjection: Equatable {
    public let coreStats: [YearReviewStatItem]
    public let wideStats: [YearReviewStatItem]
    public let compactValue: String
    public let distanceSymbol: String
    public let year: Int

    public init(
        coreStats: [YearReviewStatItem],
        wideStats: [YearReviewStatItem],
        compactValue: String,
        distanceSymbol: String,
        year: Int
    ) {
        self.coreStats = coreStats
        self.wideStats = wideStats
        self.compactValue = compactValue
        self.distanceSymbol = distanceSymbol
        self.year = year
    }

    /// The stats shown for a given grid width: wide layouts append `wideStats` (web `allStats`).
    public func stats(isWide: Bool) -> [YearReviewStatItem] {
        isWide ? coreStats + wideStats : coreStats
    }
}

/// Pure projector: `YearReviewDTO` + `YearReviewUnitPrefs` → `YearReviewProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web widget.
public enum YearReviewProjector {
    public static func project(
        stats: YearReviewDTO,
        units: YearReviewUnitPrefs,
        year: Int
    ) -> YearReviewProjection {
        // Distance pipeline, ported verbatim from the web source:
        //   distanceMi      = total_distance_km * KM_TO_MI
        //   displayDistance = convertDistanceFromSI(distanceMi, unitPrefs.distance)
        let locale = units.localeIdentifier
        let distanceMi = stats.totalDistanceKm * YearReviewConstants.kmToMile
        let displayDistance = convertYearReviewDistanceFromSI(distanceMi, to: units.distance)
        let distanceValue = YearReviewFormat.number(displayDistance, decimals: 0, localeIdentifier: locale)

        return YearReviewProjection(
            coreStats: headlineStats(stats: stats, units: units, distanceValue: distanceValue)
                + recapStats(stats: stats, units: units),
            wideStats: extendedStats(stats: stats, units: units),
            compactValue: distanceValue,
            distanceSymbol: units.distance.symbol,
            year: year
        )
    }

    /// The first three core tiles: total distance, total drives, energy used (web `coreStats[0…2]`).
    private static func headlineStats(
        stats: YearReviewDTO,
        units: YearReviewUnitPrefs,
        distanceValue: String
    ) -> [YearReviewStatItem] {
        let locale = units.localeIdentifier
        return [
            YearReviewStatItem(
                id: "total-distance",
                labelKey: "widget.yearReview.totalDistance",
                labelFallback: "Total Miles",
                value: distanceValue,
                unit: units.distance.symbol,
                systemImage: "road.lanes"
            ),
            YearReviewStatItem(
                id: "total-drives",
                labelKey: "widget.yearReview.totalDrives",
                labelFallback: "Total Drives",
                value: YearReviewFormat.integer(stats.totalDrives, localeIdentifier: locale),
                unit: nil,
                systemImage: "car.fill"
            ),
            YearReviewStatItem(
                id: "energy-used",
                labelKey: "widget.yearReview.energyUsed",
                labelFallback: "Energy Used",
                value: YearReviewFormat.number(stats.totalEnergyKwh, decimals: 1, localeIdentifier: locale),
                unit: "kWh",
                systemImage: "bolt.fill"
            )
        ]
    }

    /// The remaining three core tiles: CO₂ saved, best month, longest drive (web `coreStats[3…5]`).
    private static func recapStats(
        stats: YearReviewDTO,
        units: YearReviewUnitPrefs
    ) -> [YearReviewStatItem] {
        let locale = units.localeIdentifier
        //   longestDriveMi      = (longest_drive?.distance_km ?? 0) * KM_TO_MI
        //   displayLongestDrive = convertDistanceFromSI(longestDriveMi, unitPrefs.distance)
        let longestDriveMi = (stats.longestDriveKm ?? 0) * YearReviewConstants.kmToMile
        let displayLongestDrive = convertYearReviewDistanceFromSI(longestDriveMi, to: units.distance)
        let busiestMonth = YearReviewMonth.busiest(stats.monthlyStats, localeIdentifier: locale)
        return [
            YearReviewStatItem(
                id: "co2-saved",
                labelKey: "widget.yearReview.co2Saved",
                labelFallback: "CO₂ Saved",
                value: YearReviewFormat.number(stats.co2OffsetKg, decimals: 0, localeIdentifier: locale),
                unit: "kg",
                systemImage: "leaf.fill"
            ),
            YearReviewStatItem(
                id: "busiest-month",
                labelKey: "widget.yearReview.busiestMonth",
                labelFallback: "Best Month",
                value: busiestMonth,
                unit: nil,
                systemImage: "star.fill"
            ),
            YearReviewStatItem(
                id: "longest-drive",
                labelKey: "widget.yearReview.longestDrive",
                labelFallback: "Longest Drive",
                value: YearReviewFormat.number(displayLongestDrive, decimals: 1, localeIdentifier: locale),
                unit: units.distance.symbol,
                systemImage: "chart.line.uptrend.xyaxis"
            )
        ]
    }

    /// The two extra wide-layout tiles: driving time, top speed (web `wideStats`).
    private static func extendedStats(
        stats: YearReviewDTO,
        units: YearReviewUnitPrefs
    ) -> [YearReviewStatItem] {
        let locale = units.localeIdentifier
        // Driving time, ported verbatim: fmtInt(Math.round(total_driving_minutes / 60)).
        let drivingHours = Int(
            (YearReviewFormat.safeNumber(stats.totalDrivingMinutes) / YearReviewConstants.minutesPerHour)
                .rounded(.toNearestOrAwayFromZero)
        )
        // Top speed, ported verbatim:
        //   fastestSpeedMph     = fastest_speed_kmh * KM_TO_MI
        //   displayFastestSpeed = convertSpeedFromSI(fastestSpeedMph, unitPrefs.speed)
        let fastestSpeedMph = stats.fastestSpeedKmh * YearReviewConstants.kmToMile
        let displayFastestSpeed = convertYearReviewSpeedFromSI(fastestSpeedMph, to: units.speed)
        return [
            YearReviewStatItem(
                id: "driving-time",
                labelKey: "widget.yearReview.drivingTime",
                labelFallback: "Driving Time",
                value: YearReviewFormat.integer(drivingHours, localeIdentifier: locale),
                unit: "h",
                systemImage: "timer"
            ),
            YearReviewStatItem(
                id: "top-speed",
                labelKey: "widget.yearReview.topSpeed",
                labelFallback: "Top Speed",
                value: YearReviewFormat.number(displayFastestSpeed, decimals: 0, localeIdentifier: locale),
                unit: units.speed.symbol,
                systemImage: "chart.line.uptrend.xyaxis"
            )
        ]
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the stat grid. Pure + public so the a11y label content
/// can be unit-tested without rendering the view.
public enum YearReviewAccessibility {
    /// One spoken sentence per visible stat, e.g. "Year in Review 2026. Total Miles 7 km. …",
    /// prefixed by the surface title with its year.
    public static func summary(for projection: YearReviewProjection, isWide: Bool) -> String {
        let title = YearReviewStrings.string("widget.yearReview.title", "Year in Review")
        var parts = ["\(title) \(projection.year)"]
        for item in projection.stats(isWide: isWide) {
            if let unit = item.unit {
                parts.append("\(item.label) \(item.value) \(unit)")
            } else {
                parts.append("\(item.label) \(item.value)")
            }
        }
        return parts.joined(separator: ". ")
    }
}
