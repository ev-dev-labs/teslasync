//
//  StatHeroSlide.Adapter.swift
//  TeslaSync — P4 feature view · 0068 · StatHeroSlide (Apple)
//
//  Pure (Foundation-only) projection: cached `StatHeroSlideStats` + `StatHeroSlideUnitPrefs` + the
//  selected `StatHeroSlideField` → the display config (emoji, formatted value, unit, comparison),
//  reproducing the web source's `getStatConfig` pipeline VERBATIM so the native slide shows the exact
//  same values as features/analytics/components/review/StatHeroSlide.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web lib/unitConversion.ts + the slide source)

private enum StatHeroSlideConstants {
    /// Metres per kilometre — the SI scale the web slide applies before `convertDistanceFromSI`
    /// (`data.total_distance_km * 1000`).
    static let metersPerKilometer = 1000.0

    /// Earth's equatorial circumference in kilometres — the web slide's `earthLaps` divisor
    /// (`data.total_distance_km / 40075`).
    static let earthCircumferenceKm = 40075.0

    /// The web slide shows the "around the Earth" comparison only once at least 1% of a lap is driven
    /// (`earthLaps >= 0.01`); below that it shows the "every kilometer counts" line.
    static let earthLapThreshold = 0.01

    /// kWh-per-day home-power divisor — the web slide's `total_energy_kwh / 30` comparison factor.
    static let kwhPerHomeDay = 30.0
}

/// The emoji glyphs the web `getStatConfig` assigns per field (`🛣️` / `⚡` / `📊`). Kept as named
/// constants so the projection reads cleanly and the glyphs are defined in exactly one place.
private enum StatHeroSlideEmoji {
    static let distance = "🛣️"
    static let energy = "⚡"
    static let unknown = "📊"
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts —
/// a divide by the unit's metres-per-unit factor. Non-finite inputs collapse to 0 to match the web
/// `safeNumber` guard that wraps every displayed value.
func convertStatHeroDistanceFromSI(_ meters: Double, to unit: StatHeroSlideDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Number formatting (ported from web lib/numberFormat.ts)

/// Locale-aware number formatting that mirrors the web `fmtNumber` (`Number.toLocaleString`) the
/// slide's `AnimatedNumber` and `getStatConfig` use to render every value.
public enum StatHeroSlideFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
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
}

// MARK: - Projected slide config (web `getStatConfig` return)

/// The fully-projected hero slide: the emoji glyph, the formatted headline value, its unit suffix, the
/// fun comparison line, and a composed VoiceOver label. Mirrors the web `config` object the slide
/// renders (`emoji`, `value` → `AnimatedNumber`, `unit`, `comparison`).
public struct StatHeroSlideConfig: Equatable {
    public let field: String
    public let emoji: String
    public let value: String
    public let unit: String
    public let comparison: String
    public let accessibilityLabel: String

    public init(
        field: String,
        emoji: String,
        value: String,
        unit: String,
        comparison: String,
        accessibilityLabel: String
    ) {
        self.field = field
        self.emoji = emoji
        self.value = value
        self.unit = unit
        self.comparison = comparison
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - Projection

/// Pure projector: `StatHeroSlideStats` + `StatHeroSlideUnitPrefs` + `StatHeroSlideField` →
/// `StatHeroSlideConfig`. Every value is computed with the exact same arithmetic + formatting as the
/// web `getStatConfig`.
public enum StatHeroSlideProjector {
    public static func project(
        stats: StatHeroSlideStats,
        units: StatHeroSlideUnitPrefs,
        field: StatHeroSlideField
    ) -> StatHeroSlideConfig {
        switch field {
        case .distance:
            distanceConfig(stats: stats, units: units)
        case .energy:
            energyConfig(stats: stats, units: units)
        case let .other(raw):
            unknownConfig(field: raw)
        }
    }

    /// Web `case 'distance'`: convert `total_distance_km * 1000` metres to the display unit, format at
    /// 0 decimals, label with the raw unit symbol, and pick the Earth-lap or "every kilometer" line.
    private static func distanceConfig(
        stats: StatHeroSlideStats,
        units: StatHeroSlideUnitPrefs
    ) -> StatHeroSlideConfig {
        let locale = units.localeIdentifier
        let meters = stats.totalDistanceKm * StatHeroSlideConstants.metersPerKilometer
        let displayDistance = convertStatHeroDistanceFromSI(meters, to: units.distance)
        let value = StatHeroSlideFormat.number(displayDistance, decimals: 0, localeIdentifier: locale)
        let unit = units.distance.symbol

        let earthLaps = stats.totalDistanceKm / StatHeroSlideConstants.earthCircumferenceKm
        let comparison: String
        if earthLaps >= StatHeroSlideConstants.earthLapThreshold {
            let percent = StatHeroSlideFormat.number(earthLaps * 100, decimals: 1, localeIdentifier: locale)
            comparison = StatHeroSlideStrings.interpolate(
                "yearReview.distanceComparison",
                "That's {{percent}}% around the Earth!",
                ["percent": percent]
            )
        } else {
            comparison = StatHeroSlideStrings.string("yearReview.distanceSmall", "Every kilometer counts!")
        }

        return StatHeroSlideConfig(
            field: StatHeroSlideField.distance.rawValue,
            emoji: StatHeroSlideEmoji.distance,
            value: value,
            unit: unit,
            comparison: comparison,
            accessibilityLabel: accessibilityLabel(value: value, unit: unit, comparison: comparison)
        )
    }

    /// Web `case 'energy'`: the raw kWh value at 0 decimals, the "kWh charged" unit, and the
    /// home-power comparison rounded to whole days.
    private static func energyConfig(
        stats: StatHeroSlideStats,
        units: StatHeroSlideUnitPrefs
    ) -> StatHeroSlideConfig {
        let locale = units.localeIdentifier
        let value = StatHeroSlideFormat.number(stats.totalEnergyKwh, decimals: 0, localeIdentifier: locale)
        let unit = StatHeroSlideStrings.string("yearReview.energyUnit", "kWh charged")

        // Web: Math.round(data.total_energy_kwh / 30). i18next renders the number via String(value),
        // so the day count is ungrouped (matching `{ days: Math.round(...) }`).
        let days = Int(
            (StatHeroSlideFormat.safeNumber(stats.totalEnergyKwh) / StatHeroSlideConstants.kwhPerHomeDay)
                .rounded(.toNearestOrAwayFromZero)
        )
        let comparison = StatHeroSlideStrings.interpolate(
            "yearReview.energyComparison",
            "Enough to power a home for {{days}} days",
            ["days": String(days)]
        )

        return StatHeroSlideConfig(
            field: StatHeroSlideField.energy.rawValue,
            emoji: StatHeroSlideEmoji.energy,
            value: value,
            unit: unit,
            comparison: comparison,
            accessibilityLabel: accessibilityLabel(value: value, unit: unit, comparison: comparison)
        )
    }

    /// Web `default`: the 📊 zero slide for an unrecognised field (value 0, no unit, no comparison).
    /// Reproduced rather than hidden so an unexpected field still renders a valid surface.
    private static func unknownConfig(field: String) -> StatHeroSlideConfig {
        let value = StatHeroSlideFormat.number(0, decimals: 0)
        return StatHeroSlideConfig(
            field: field,
            emoji: StatHeroSlideEmoji.unknown,
            value: value,
            unit: "",
            comparison: "",
            accessibilityLabel: accessibilityLabel(value: value, unit: "", comparison: "")
        )
    }

    /// Composes the spoken VoiceOver label from the visible pieces ("value unit. comparison"), so the
    /// slide reads as one coherent sentence regardless of which pieces are present.
    static func accessibilityLabel(value: String, unit: String, comparison: String) -> String {
        var parts: [String] = []
        parts.append(unit.isEmpty ? value : "\(value) \(unit)")
        if !comparison.isEmpty {
            parts.append(comparison)
        }
        return parts.joined(separator: ". ")
    }
}
