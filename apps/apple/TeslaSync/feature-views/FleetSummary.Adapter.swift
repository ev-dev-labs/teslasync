//
//  FleetSummary.Adapter.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  The testable projection core for the Fleet Summary — the SwiftUI parity of
//  features/vehicles/components/FleetSummary.tsx. Reproduces the web source's numeric
//  pipeline VERBATIM so the native surface shows the same values:
//    • vehicle count (web `vehicles.length`),
//    • average battery % (web `sum(battery_level)/length`, rounded),
//    • total rated range with the exact `convertDistanceFromSI` + `fmtNumber` math,
//    • charging / online counts (web `is_charging` filter + resolved-state length),
//    • the live-state freshness age label (web `refetchInterval` freshness treatment).
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection compile
//  and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on top
//  in the other FleetSummary.* files.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting mirroring the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half
/// away from zero to match `Intl.NumberFormat`'s default `halfExpand`. The web tiles
/// pre-round with `Math.round` then `fmtNumber(_, 0)`; for the non-negative fleet
/// aggregates here a single `halfUp` format at 0 fraction digits is identical.
public enum FleetFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-up.
    public static func number(_ value: Double, decimals: Int = 0, localeIdentifier: String = "en_US") -> String {
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
}

// MARK: - SI conversion (ported from web lib/unitConversion.ts)

/// SI→display distance conversion matching the web `convertDistanceFromSI` the range
/// tile uses (`convertDistanceFromSI(totalRangeMeters, unitPrefs.distance)`). Constants
/// are byte-for-byte the web `METERS_PER_KM` / `METERS_PER_MILE` / `METERS_PER_FOOT`.
public enum FleetConvert {
    static let metersPerKm = 1000.0
    static let metersPerMile = 1609.344
    static let metersPerFoot = 0.3048

    /// `convertDistanceFromSI(meters, to)` — unit label `km` / `mi` / `ft`.
    public static func distanceFromSI(_ meters: Double, to unit: String) -> Double {
        switch unit {
        case "mi": meters / metersPerMile
        case "ft": meters / metersPerFoot
        default: meters / metersPerKm
        }
    }
}

// MARK: - Relative time (web freshness age label)

/// Relative-time helper for the freshness chip. The strings resolve through the P1/S10
/// facade so the native surface holds no hardcoded English.
public enum FleetRelativeTime {
    /// Freshness `formatAge(age)` — the stale-chip / freshness-chip age label.
    public static func formatAge(_ date: Date?, now: Date = Date()) -> String {
        guard let date else {
            return FleetSummaryStrings.string("fleet.summary.age.unknown", "—")
        }
        let age = Int(max(0, now.timeIntervalSince(date)))
        if age < 10 {
            return FleetSummaryStrings.string("fleet.summary.age.justNow", "just now")
        }
        if age < 60 {
            return FleetSummaryStrings.format("fleet.summary.age.seconds", "%ds ago", age)
        }
        if age < 3600 {
            return FleetSummaryStrings.format("fleet.summary.age.minutes", "%dm ago", age / 60)
        }
        return FleetSummaryStrings.format("fleet.summary.age.hours", "%dh ago", age / 3600)
    }
}

// MARK: - Metric tile (web GlassPanel stat tile)

/// One fleet-summary stat tile — the native parity of a web `GlassPanel` stat. Free of
/// SwiftUI; the view maps `iconTone` + `systemImage` to tokens.
public struct FleetMetric: Identifiable, Equatable, Sendable {
    /// The decorative icon tint (web `text-cyan-400` / `text-green-500` /
    /// `text-purple-400` / `text-amber-400`).
    public enum IconTone: String, Sendable, Equatable {
        case vehicles
        case battery
        case range
        case charging
    }

    public let id: String
    public let systemImage: String
    public let iconTone: IconTone
    /// The formatted primary value (web `AnimatedNumber` content, incl. a `%` suffix
    /// for battery).
    public let value: String
    /// The secondary `/ N` clause for the charging tile (web `/ {onlineCount}`), else
    /// `nil`.
    public let secondary: String?
    /// Whether the value renders in success green (web charging tile `text-green-500`).
    public let valueHighlighted: Bool
    public let labelKey: String
    public let labelFallback: String
    /// The unit token appended to the label (web `totalRange` + `unitPrefs.distance`),
    /// else `nil`.
    public let labelUnitSuffix: String?
    /// The spoken value for VoiceOver (e.g. "82%", "1,240 km", "2 of 5").
    public let accessibilityValue: String

    public init(
        id: String,
        systemImage: String,
        iconTone: IconTone,
        value: String,
        secondary: String? = nil,
        valueHighlighted: Bool = false,
        labelKey: String,
        labelFallback: String,
        labelUnitSuffix: String? = nil,
        accessibilityValue: String
    ) {
        self.id = id
        self.systemImage = systemImage
        self.iconTone = iconTone
        self.value = value
        self.secondary = secondary
        self.valueHighlighted = valueHighlighted
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.labelUnitSuffix = labelUnitSuffix
        self.accessibilityValue = accessibilityValue
    }

    /// The localized tile label, with the optional unit token appended (web
    /// `{t('fleet.totalRange')} {unitPrefs.distance}`).
    public var localizedLabel: String {
        let base = FleetSummaryStrings.string(labelKey, labelFallback)
        guard let labelUnitSuffix, !labelUnitSuffix.isEmpty else { return base }
        return "\(base) \(labelUnitSuffix)"
    }

    /// The full spoken phrase (e.g. "Total Range 1,240 km").
    public var spoken: String {
        "\(localizedLabel) \(accessibilityValue)"
    }
}

// MARK: - Projection

/// The fully-projected, view-ready summary derived from one `FleetSummaryUpdate`.
/// Carries the four metric tiles plus the raw aggregates (kept for tests + a11y) and the
/// freshness age label. Every value is computed with the same arithmetic + formatting as
/// the web component so the surfaces show identical numbers side by side.
public struct FleetSummaryProjection: Equatable, Sendable {
    public let vehicleCount: Int
    public let averageBattery: Double
    public let totalRangeMeters: Double
    public let chargingCount: Int
    public let onlineCount: Int
    public let distanceUnit: String
    public let metrics: [FleetMetric]
    public let ageLabel: String
    /// Whether any vehicle state resolved (web `states.length > 0`). Drives the
    /// "no readings yet" empty hint inside the content tiles.
    public let hasResolvedStates: Bool

    public init(
        vehicleCount: Int,
        averageBattery: Double,
        totalRangeMeters: Double,
        chargingCount: Int,
        onlineCount: Int,
        distanceUnit: String,
        metrics: [FleetMetric],
        ageLabel: String,
        hasResolvedStates: Bool
    ) {
        self.vehicleCount = vehicleCount
        self.averageBattery = averageBattery
        self.totalRangeMeters = totalRangeMeters
        self.chargingCount = chargingCount
        self.onlineCount = onlineCount
        self.distanceUnit = distanceUnit
        self.metrics = metrics
        self.ageLabel = ageLabel
        self.hasResolvedStates = hasResolvedStates
    }
}

/// Pure projector: `FleetSummaryUpdate` → `FleetSummaryProjection`. Reproduces the web
/// component's aggregation + formatting VERBATIM.
public enum FleetSummaryProjector {
    public static func project(update: FleetSummaryUpdate, now: Date = Date()) -> FleetSummaryProjection {
        let states = update.resolvedStates
        let locale = update.units.localeIdentifier
        let distanceUnit = update.units.distance

        // web: states.length > 0 ? sum(battery_level ?? 0) / states.length : 0
        let averageBattery = states.isEmpty
            ? 0
            : states.reduce(0.0) { $0 + Double($1.batteryLevel ?? 0) } / Double(states.count)
        // web: states.reduce((sum, st) => sum + (st.rated_range ?? 0), 0)  — SI metres
        let totalRangeMeters = states.reduce(0.0) { $0 + ($1.ratedRangeMeters ?? 0) }
        // web: states.filter(st => st.is_charging).length
        let chargingCount = states.count(where: { $0.isCharging == true })
        // web: onlineCount = states.length
        let onlineCount = states.count
        let vehicleCount = update.vehicles.count

        let rangeDisplay = FleetConvert.distanceFromSI(totalRangeMeters, to: distanceUnit)

        let formatted = MetricStrings(
            vehicle: FleetFormat.number(Double(vehicleCount), localeIdentifier: locale),
            battery: FleetFormat.number(averageBattery, localeIdentifier: locale),
            range: FleetFormat.number(rangeDisplay, localeIdentifier: locale),
            charging: FleetFormat.number(Double(chargingCount), localeIdentifier: locale),
            online: "\(onlineCount)",
            distanceUnit: distanceUnit
        )

        return FleetSummaryProjection(
            vehicleCount: vehicleCount,
            averageBattery: averageBattery,
            totalRangeMeters: totalRangeMeters,
            chargingCount: chargingCount,
            onlineCount: onlineCount,
            distanceUnit: distanceUnit,
            metrics: buildMetrics(formatted),
            ageLabel: FleetRelativeTime.formatAge(update.updatedAt, now: now),
            hasResolvedStates: !states.isEmpty
        )
    }

    /// The pre-formatted, locale-resolved value strings the four tiles render.
    private struct MetricStrings {
        let vehicle: String
        let battery: String
        let range: String
        let charging: String
        let online: String
        let distanceUnit: String
    }

    /// Builds the four tiles in the web render order: Vehicles, Avg Battery, Total
    /// Range, Charging / Online.
    private static func buildMetrics(_ strings: MetricStrings) -> [FleetMetric] {
        [
            FleetMetric(
                id: "vehicles",
                systemImage: "car.fill",
                iconTone: .vehicles,
                value: strings.vehicle,
                labelKey: "fleet.vehicles",
                labelFallback: "Vehicles",
                accessibilityValue: strings.vehicle
            ),
            FleetMetric(
                id: "avgBattery",
                systemImage: "battery.100",
                iconTone: .battery,
                value: "\(strings.battery)%",
                labelKey: "fleet.avgBattery",
                labelFallback: "Avg Battery",
                accessibilityValue: "\(strings.battery)%"
            ),
            FleetMetric(
                id: "totalRange",
                systemImage: "gauge.medium",
                iconTone: .range,
                value: strings.range,
                labelKey: "fleet.totalRange",
                labelFallback: "Total Range",
                labelUnitSuffix: strings.distanceUnit,
                // The unit travels on the label (web `{totalRange} {distance}`), so the
                // spoken value stays just the number to avoid a doubled unit.
                accessibilityValue: strings.range
            ),
            FleetMetric(
                id: "chargingOnline",
                systemImage: "bolt.fill",
                iconTone: .charging,
                value: strings.charging,
                secondary: "/ \(strings.online)",
                valueHighlighted: true,
                labelKey: "fleet.chargingOnline",
                labelFallback: "Charging / Online",
                accessibilityValue: FleetSummaryStrings.format(
                    "fleet.summary.a11y.chargingValue",
                    "%1$@ of %2$@",
                    strings.charging,
                    strings.online
                )
            )
        ]
    }
}
