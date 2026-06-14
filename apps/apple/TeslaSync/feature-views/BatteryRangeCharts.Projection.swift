//
//  BatteryRangeCharts.Projection.swift
//  TeslaSync — P4 feature view · 0288 · BatteryRangeCharts (Apple)
//
//  The pure render-branch projection (no SwiftUI, no networking) for the BatteryRangeCharts
//  surface — the native port of the `BatteryRangeCharts.tsx` JSX + its `useMemo` derivations.
//  Maps a cached `BatteryRangeChartsSnapshot` (plus the user's `useUnits()` preference) into the
//  localized `BatteryRangeChartsContent`: the radial battery gauge (web `RadialGauge`), the
//  Battery % / Range tiles (web `AnimatedNumber`), the Current-vs-Remaining bars (web
//  `batteryChartData`), and the reversed distance + duration trend points (web `driveChartData`).
//  The SI distance / number / date math reproduces `lib/unitConversion.ts`
//  `convertDistanceFromSI`, `lib/numberFormat.ts` `fmtNumber`, and `lib/dateFormat.ts`
//  `formatDate` so every platform renders identical strings. SwiftUI-free so each value can be
//  unit tested on a plain host.
//

import Foundation

// MARK: - Distance conversion + number / date formatting (web parity)

/// Pure SI-meters → display converter + the `fmtNumber()` / `formatDate()` helpers, reproducing
/// the web `lib/unitConversion.ts` `convertDistanceFromSI`, `lib/numberFormat.ts` `fmtNumber`,
/// and `lib/dateFormat.ts` `formatDate` so every platform shows identical strings. SwiftUI-free
/// so the math can be unit-tested on a plain host.
public enum BatteryRangeChartsMath {
    /// The em-dash the web renders for an absent / non-finite reading.
    public static let emDash = BatteryRangeChartsFormat.dash

    /// The web distance precision default (`DEFAULT_PRECISION.distance`).
    public static let defaultDistancePrecision = 1
    /// The web `getGlobalPrecision()` default the `RadialGauge` falls back to for a fractional level.
    public static let defaultGaugePrecision = 2

    /// 1 mile = 1609.344 m exactly (international yard, NIST) — web `METERS_PER_MILE`.
    static let metersPerMile = 1609.344
    /// 1 km = 1000 m exactly — web `METERS_PER_KM`.
    static let metersPerKm = 1000.0
    /// 1 ft = 0.3048 m exactly (international foot, NIST) — web `METERS_PER_FOOT`.
    static let metersPerFoot = 0.3048

    /// Web `convertDistanceFromSI(meters, to)`: SI meters → the display unit's numeric value.
    public static func convertDistanceFromSI(
        _ meters: Double,
        to unit: BatteryRangeChartsDistanceUnit
    ) -> Double {
        switch unit {
        case .kilometers: meters / metersPerKm
        case .miles: meters / metersPerMile
        case .feet: meters / metersPerFoot
        }
    }

    /// Web `fmtNumber(v, decimals, locale)`: locale-grouped formatting at a fixed number of
    /// fraction digits with the non-finite → 0 guard. Half-up rounding mirrors
    /// `Intl.NumberFormat`'s default for the non-negative values this surface formats.
    public static func number(_ value: Double, decimals: Int, localeIdentifier: String) -> String {
        let digits = max(0, decimals)
        let safeValue = value.isFinite ? value : 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = digits
        formatter.maximumFractionDigits = digits
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: safeValue)) ?? String(format: "%.\(digits)f", safeValue)
    }

    /// Web `Math.round(x)`: round half toward +∞. For the non-negative distances / durations this
    /// surface rounds, that equals Swift's `.toNearestOrAwayFromZero`.
    public static func roundHalfUp(_ value: Double) -> Double {
        guard value.isFinite else { return 0 }
        return value.rounded(.toNearestOrAwayFromZero)
    }

    /// Web `convertDistanceFromSI` + `Math.round` — the rounded display distance for the trend
    /// chart (web `Math.round(convertDistanceFromSI(distance_m ?? 0, unit))`).
    public static func roundedDistance(
        _ meters: Double?,
        unit: BatteryRangeChartsDistanceUnit
    ) -> Double {
        roundHalfUp(convertDistanceFromSI(meters ?? 0, to: unit))
    }

    /// Web `Math.round((duration_s ?? 0) / 60)` — the rounded drive duration in minutes.
    public static func roundedMinutes(_ seconds: Double?) -> Double {
        roundHalfUp((seconds ?? 0) / 60)
    }

    /// The radial gauge's percent text (web `RadialGauge`: `decimals ?? (isInteger ? 0 :
    /// getGlobalPrecision())` over `Math.max(0, Math.min(value, max))`). An absent / non-finite
    /// level reads as the em-dash.
    public static func gaugePercentText(
        _ level: Double?,
        preferencePrecision: Int?,
        localeIdentifier: String
    ) -> String {
        guard let level, level.isFinite else { return emDash }
        let clamped = min(max(level, 0), 100)
        let isInteger = clamped == clamped.rounded()
        let decimals = isInteger ? 0 : (preferencePrecision ?? defaultGaugePrecision)
        return number(clamped, decimals: decimals, localeIdentifier: localeIdentifier)
    }

    /// Web `batteryColor(level)` thresholds → the gauge band (`> 60` high, `> 25` medium, else
    /// low; an absent / non-finite level is unknown).
    public static func band(for level: Double?) -> BatteryRangeChartsBatteryBand {
        guard let level, level.isFinite else { return .unknown }
        if level > 60 { return .high }
        if level > 25 { return .medium }
        return .low
    }

    /// Web `formatDate(start_ts)` — `toLocaleDateString(locale, { year:'numeric', month:'short',
    /// day:'numeric' })`. An absent / invalid date reads as the em-dash (web `if (!iso) return
    /// '—'`). Uses the device time zone, like the web's local-time rendering.
    public static func dateLabel(_ date: Date?, localeIdentifier: String) -> String {
        guard let date else { return emDash }
        return Self.dateFormatter(localeIdentifier: localeIdentifier).string(from: date)
    }

    /// A medium-date formatter (web `formatDate`'s `{ year, month:'short', day }`) for a locale.
    static func dateFormatter(localeIdentifier: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.setLocalizedDateFormatFromTemplate("yMMMd")
        return formatter
    }
}

// MARK: - Projection (web render branches + `useMemo` → the content model)

/// Projects the cached snapshot into the localized content model, reproducing every web render
/// branch + `useMemo`. `localize` is the P1/S10 `t(key, fallback)` facade; passing an echo
/// (returns the fallback) yields the web English copy. `prefs` carries the distance unit + locale
/// + precision resolved from `useUnits()`.
public enum BatteryRangeChartsProjection {
    public static func content(
        snapshot: BatteryRangeChartsSnapshot?,
        prefs: BatteryRangeChartsUnitPrefs,
        localize: (String, String) -> String
    ) -> BatteryRangeChartsContent {
        let state = snapshot?.state
        return BatteryRangeChartsContent(
            gauge: gauge(state, prefs, localize),
            batteryMetric: batteryMetric(state, prefs, localize),
            rangeMetric: rangeMetric(state, prefs, localize),
            batteryBars: batteryBars(state, prefs, localize),
            drivePoints: drivePoints(snapshot?.drives ?? [], prefs),
            distanceUnitSymbol: prefs.distance.symbol,
            hasState: state != nil
        )
    }

    // MARK: Radial gauge (web `RadialGauge value={battery_level} max={100} unit="%"`)

    private static func gauge(
        _ state: BatteryRangeChartsState?,
        _ prefs: BatteryRangeChartsUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangeChartsGauge {
        let label = localize("common.battery", "Battery")
        let level = state?.batteryLevel
        let clamped = level.flatMap { $0.isFinite ? min(max($0, 0), 100) : nil }
        let hasValue = clamped != nil
        let valueText = BatteryRangeChartsMath.gaugePercentText(
            level,
            preferencePrecision: prefs.precision,
            localeIdentifier: prefs.localeIdentifier
        )
        let unit = BatteryRangeChartsFormat.percent
        let spoken = hasValue ? "\(valueText)\(unit)" : valueText
        return BatteryRangeChartsGauge(
            label: label,
            valueText: valueText,
            unit: unit,
            fraction: (clamped ?? 0) / 100,
            hasValue: hasValue,
            band: BatteryRangeChartsMath.band(for: level),
            accessibilityLabel: "\(label): \(spoken)"
        )
    }

    // MARK: Battery tile (web `<AnimatedNumber value={battery_level} suffix="%" />`, decimals 0)

    private static func batteryMetric(
        _ state: BatteryRangeChartsState?,
        _ prefs: BatteryRangeChartsUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangeChartsMetric {
        let label = localize("common.battery", "Battery")
        let level = state?.batteryLevel
        let value: String = if let level, level.isFinite {
            BatteryRangeChartsMath.number(level, decimals: 0, localeIdentifier: prefs.localeIdentifier)
                + BatteryRangeChartsFormat.percent
        } else {
            BatteryRangeChartsMath.emDash
        }
        return BatteryRangeChartsMetric(
            id: "battery",
            label: label,
            value: value,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Range tile (web `<AnimatedNumber value={convertDistanceFromSI(rated_range)} decimals={0} suffix=" {unit}" />`)

    private static func rangeMetric(
        _ state: BatteryRangeChartsState?,
        _ prefs: BatteryRangeChartsUnitPrefs,
        _ localize: (String, String) -> String
    ) -> BatteryRangeChartsMetric {
        let label = localize("common.range", "Range")
        let meters = state?.ratedRangeMeters
        let value: String
        if let meters, meters.isFinite {
            let converted = BatteryRangeChartsMath.convertDistanceFromSI(meters, to: prefs.distance)
            let number = BatteryRangeChartsMath.number(
                converted,
                decimals: 0,
                localeIdentifier: prefs.localeIdentifier
            )
            value = "\(number) \(prefs.distance.symbol)"
        } else {
            value = BatteryRangeChartsMath.emDash
        }
        return BatteryRangeChartsMetric(
            id: "range",
            label: label,
            value: value,
            accessibilityLabel: "\(label): \(value)"
        )
    }

    // MARK: Battery bars (web `batteryChartData` — Current = level, Remaining = 100 − level)

    private static func batteryBars(
        _ state: BatteryRangeChartsState?,
        _ prefs: BatteryRangeChartsUnitPrefs,
        _ localize: (String, String) -> String
    ) -> [BatteryRangeChartsBatteryBar] {
        let rawLevel = state?.batteryLevel
        let level = (rawLevel?.isFinite ?? false) ? min(max(rawLevel ?? 0, 0), 100) : 0
        let remaining = 100 - level
        func display(_ value: Double) -> String {
            BatteryRangeChartsMath.number(value, decimals: 0, localeIdentifier: prefs.localeIdentifier)
                + BatteryRangeChartsFormat.percent
        }
        return [
            BatteryRangeChartsBatteryBar(
                id: "current",
                name: localize("common.current", "Current"),
                value: level,
                display: display(level)
            ),
            BatteryRangeChartsBatteryBar(
                id: "remaining",
                name: localize("common.remaining", "Remaining"),
                value: remaining,
                display: display(remaining)
            )
        ]
    }

    // MARK: Drive points (web `driveChartData` — mapped then `.reverse()`)

    private static func drivePoints(
        _ drives: [BatteryRangeChartsDrive],
        _ prefs: BatteryRangeChartsUnitPrefs
    ) -> [BatteryRangeChartsDrivePoint] {
        let formatter = BatteryRangeChartsMath.dateFormatter(localeIdentifier: prefs.localeIdentifier)
        // Web maps the incoming drives then reverses the whole array (oldest → newest on the x axis).
        let reversed = Array(drives.reversed())
        return reversed.enumerated().map { index, drive in
            let dateLabel = drive.startTimestamp.map { formatter.string(from: $0) }
                ?? BatteryRangeChartsMath.emDash
            return BatteryRangeChartsDrivePoint(
                id: drive.id,
                order: index,
                dateLabel: dateLabel,
                distance: BatteryRangeChartsMath.roundedDistance(drive.distanceMeters, unit: prefs.distance),
                duration: BatteryRangeChartsMath.roundedMinutes(drive.durationSeconds)
            )
        }
    }

    // MARK: - Phase resolution (web parent `isLoading` envelope + content/empty split)

    /// Resolves the render phase from the bound load status + whether a vehicle-state snapshot
    /// resolved. The web is always-on from its props; the native leaf shows the skeleton only on
    /// the initial fetch, keeps cached content behind refresh / errors, and falls back to the
    /// empty state when no state is known (resolved) or the error state (failed, no cache).
    public static func resolvePhase(
        status: BatteryRangeChartsLoadStatus,
        hasState: Bool
    ) -> BatteryRangeChartsPhase {
        switch status {
        case .loading:
            hasState ? .content : .loading
        case .loaded:
            hasState ? .content : .empty
        case let .failed(message):
            hasState ? .content : .error(message)
        }
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's chart-level VoiceOver strings. Copy resolves through an injected
/// localizer (`(key, fallback) -> String`) so the summaries are testable without a bundle,
/// exactly like the view's P1/S10 facade.
public enum BatteryRangeChartsAccessibility {
    /// The Current-vs-Remaining bar-chart summary: "Battery Overview: Current X%, Remaining Y%".
    public static func batteryChartSummary(
        bars: [BatteryRangeChartsBatteryBar],
        localize: (String, String) -> String
    ) -> String {
        let title = localize("vehicles.detail.batteryOverview", "Battery Overview")
        let parts = bars.map { "\($0.name) \($0.display)" }.joined(separator: ", ")
        return parts.isEmpty ? title : "\(title): \(parts)"
    }

    /// The drive-trend summary: the title + the drive count, or the web empty message when there
    /// are no points.
    public static func driveChartSummary(
        points: [BatteryRangeChartsDrivePoint],
        unitSymbol: String,
        localize: (String, String) -> String
    ) -> String {
        let title = localize("vehicles.detail.driveTrend", "Drive Distance Trend")
        guard !points.isEmpty else {
            return "\(title): \(localize("vehicles.detail.noDriveData", "No drive data for chart"))"
        }
        let drivesNoun = localize("vehicles.detail.driveTrend.drivesNoun", "drives")
        let distance = localize("common.distance", "Distance")
        let duration = localize("common.duration", "Duration")
        return "\(title): \(points.count) \(drivesNoun), \(distance) (\(unitSymbol)), \(duration)"
    }

    /// One drive point's VoiceOver value: "{date}: {distance} {unit}, {duration} min".
    public static func drivePointValue(
        _ point: BatteryRangeChartsDrivePoint,
        unitSymbol: String,
        localize: (String, String) -> String
    ) -> String {
        let distance = localize("common.distance", "Distance")
        let duration = localize("common.duration", "Duration")
        let minutes = localize("vehicles.detail.driveTrend.minutesNoun", "min")
        return "\(point.dateLabel): \(distance) \(numberString(point.distance)) \(unitSymbol), "
            + "\(duration) \(numberString(point.duration)) \(minutes)"
    }

    private static func numberString(_ value: Double) -> String {
        let rounded = value.rounded()
        if value == rounded { return String(Int(rounded)) }
        return String(value)
    }
}
