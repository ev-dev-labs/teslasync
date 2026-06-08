//
//  PatternsSlide.Adapter.swift
//  TeslaSync — P4 feature view · 0064 · PatternsSlide (Apple)
//
//  Pure (Foundation-only) projection: cached `PatternsReviewDTO` + `PatternsUnitPrefs` → display
//  strings, reproducing the web source's numeric pipeline VERBATIM so the native surface shows the
//  exact same values as features/analytics/components/review/PatternsSlide.tsx.
//
//  This file is deliberately free of SwiftUI so the conversion + formatting can be compiled and
//  executed on a plain host and pinned by unit tests.
//

import Foundation

// MARK: - Conversion constants (ported from web PatternsSlide.tsx + lib/unitConversion.ts)

private enum PatternsConstants {
    /// `KM_PER_MILE` from PatternsSlide.tsx (L9). Rescales the SI Wh/km efficiency into Wh/mi for the
    /// mile preference (`avg_efficiency_wh_km * KM_PER_MILE`).
    static let kmPerMile = 1.609344

    /// The web `* 1000` factor: kilometres → metres before `convertDistanceFromSI`.
    static let metersPerKm = 1000.0
}

// MARK: - Unit + number helpers (ported verbatim from the web libs)

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` (lib/unitConversion.ts):
/// a divide by the unit's metres-per-unit factor. Non-finite inputs collapse to 0 (web `safeNumber`).
func convertPatternsDistanceFromSI(_ meters: Double, to unit: PatternsDistanceUnit) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

/// `Math.round` parity: JavaScript rounds halves toward +∞ (`Math.round(-2.5) === -2`), which equals
/// `floor(x + 0.5)`. Reproduced exactly so the rounded miles / efficiency integers match the web
/// byte-for-byte. Non-finite inputs collapse to 0.
func patternsRoundedInt(_ value: Double) -> Int {
    guard value.isFinite else { return 0 }
    return Int((value + 0.5).rounded(.down))
}

/// Locale-aware number formatting that mirrors the web `fmtNumber` (`Number.toLocaleString`).
public enum PatternsFormat {
    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, rounding half away from zero
    /// to match `Number.toLocaleString`'s default `halfExpand`.
    public static func number(
        _ value: Double,
        decimals: Int,
        localeIdentifier: String = "en_US"
    ) -> String {
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

// MARK: - Peak-hour label (web template literal, PatternsSlide.tsx L26-28)

/// Builds the 12-hour peak-hour label. Pure + public so the parity logic is unit-tested without
/// rendering.
public enum PatternsHour {
    /// The `"{h} AM"` / `"{h} PM"` label, reproduced VERBATIM from the web template literal. The AM/PM
    /// tokens are format tokens — like the unit symbols `km` / `Wh/mi` the source also emits literally —
    /// not translatable copy in the web source, so they are produced literally here for value parity.
    public static func label(_ hour: Int) -> String {
        if hour >= 12 {
            let twelveHour = hour == 12 ? 12 : hour - 12
            return "\(twelveHour) PM"
        }
        let twelveHour = hour == 0 ? 12 : hour
        return "\(twelveHour) AM"
    }
}

// MARK: - Projection

/// The fully-projected slide content: the favourite weekday, the peak-hour label, and the three
/// summary metrics (drives per week, distance per drive, efficiency) with their display unit symbols.
/// Computed once per snapshot by the model.
public struct PatternsProjection: Equatable {
    public let favoriteDay: String
    public let peakHour: String
    public let drivesPerWeek: String
    public let distancePerDrive: String
    public let distanceSymbol: String
    public let efficiency: String
    public let efficiencySymbol: String

    public init(
        favoriteDay: String,
        peakHour: String,
        drivesPerWeek: String,
        distancePerDrive: String,
        distanceSymbol: String,
        efficiency: String,
        efficiencySymbol: String
    ) {
        self.favoriteDay = favoriteDay
        self.peakHour = peakHour
        self.drivesPerWeek = drivesPerWeek
        self.distancePerDrive = distancePerDrive
        self.distanceSymbol = distanceSymbol
        self.efficiency = efficiency
        self.efficiencySymbol = efficiencySymbol
    }
}

/// Pure projector: `PatternsReviewDTO` + `PatternsUnitPrefs` → `PatternsProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web slide.
public enum PatternsProjector {
    /// The em-dash returned when the busiest weekday is unknown — web `most_active_day_of_week || '—'`
    /// (an empty string is falsy in JS, so it also resolves to the dash).
    public static let unknownDay = "—"

    public static func project(stats: PatternsReviewDTO, units: PatternsUnitPrefs) -> PatternsProjection {
        let locale = units.localeIdentifier

        // Distance per drive, ported verbatim:
        //   avgDistDisplay = convertDistanceFromSI(avg_distance_per_drive_km * 1000, distance)
        //   render Math.round(avgDistDisplay)
        let displayDistance = convertPatternsDistanceFromSI(
            stats.avgDistancePerDriveKm * PatternsConstants.metersPerKm,
            to: units.distance
        )

        // Efficiency, ported verbatim:
        //   avgEffDisplay = distance === 'mi' ? avg_efficiency_wh_km * KM_PER_MILE : avg_efficiency_wh_km
        //   render Math.round(avgEffDisplay)
        let displayEfficiency = units.distance == .miles
            ? stats.avgEfficiencyWhKm * PatternsConstants.kmPerMile
            : stats.avgEfficiencyWhKm

        let day = stats.mostActiveDayOfWeek.flatMap { $0.isEmpty ? nil : $0 } ?? unknownDay

        return PatternsProjection(
            favoriteDay: day,
            peakHour: PatternsHour.label(stats.mostActiveHour),
            drivesPerWeek: PatternsFormat.number(stats.avgDrivesPerWeek, decimals: 1, localeIdentifier: locale),
            distancePerDrive: String(patternsRoundedInt(displayDistance)),
            distanceSymbol: units.distance.symbol,
            efficiency: String(patternsRoundedInt(displayEfficiency)),
            efficiencySymbol: units.distance.efficiencySymbol
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the slide. Pure + public so the a11y label content can be
/// unit-tested without rendering the view. Every fragment resolves through the P1/S10 i18n facade, so
/// the exact set of source keys is exercised here.
public enum PatternsAccessibility {
    public static func summary(for projection: PatternsProjection) -> String {
        let title = PatternsStrings.string("yearReview.drivingPatterns", "Your driving patterns")
        let favoriteLabel = PatternsStrings.string("yearReview.favoriteDay", "Favorite driving day")
        let peakLabel = PatternsStrings.string("yearReview.peakHour", "Peak driving hour")
        let drivesLabel = PatternsStrings.string("yearReview.drivesWeek", "drives/week")
        let distanceLabel = PatternsStrings.unit(
            "yearReview.distancePerDrive",
            "{unit}/drive avg",
            projection.distanceSymbol
        )
        let avgLabel = PatternsStrings.string("yearReview.avg", "avg")
        return [
            title,
            "\(favoriteLabel) \(projection.favoriteDay)",
            "\(peakLabel) \(projection.peakHour)",
            "\(projection.drivesPerWeek) \(drivesLabel)",
            "\(projection.distancePerDrive) \(distanceLabel)",
            "\(projection.efficiency) \(projection.efficiencySymbol) \(avgLabel)"
        ].joined(separator: ". ")
    }
}
