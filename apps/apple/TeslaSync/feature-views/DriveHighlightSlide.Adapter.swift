//
//  DriveHighlightSlide.Adapter.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  Pure (Foundation-only) projection: cached `DriveHighlightReviewDTO` + `DriveHighlightSlideUnitPrefs`
//  → the display values the slide renders, reproducing the web source's arithmetic VERBATIM so the
//  native surface shows the exact same figures as
//  features/analytics/components/review/DriveHighlightSlide.tsx:
//
//      hours       = Math.floor(duration_min / 60)
//      mins        = duration_min % 60
//      durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
//      distDisplay = Math.round(convertDistanceFromSI(distance_km * 1000, distanceUnit))
//      effDisplay  = distanceUnit === 'mi' ? efficiency_wh_km * KM_PER_MILE : efficiency_wh_km
//      effShown    = efficiency_wh_km > 0 ? Math.round(effDisplay) : '—'
//      route       = (start_address || '—') → (end_address || '—')
//
//  Numbers are rendered like the web leaf: `Math.round(...)` then plain string interpolation, so they
//  are NOT locale-grouped (the web does not pass these through `toLocaleString`). This file is
//  deliberately free of SwiftUI so the conversion + formatting can be compiled and executed on a plain
//  host and pinned by unit tests.
//

import Foundation

// MARK: - Constants (ported from the web source)

private enum DriveHighlightSlideConstants {
    /// Metres per kilometre — the SI scale the web slide applies before `convertDistanceFromSI`
    /// (`drive.distance_km * 1000`).
    static let metersPerKilometer = 1000.0

    /// Kilometres per mile — the web `KM_PER_MILE` constant used to turn the SI `Wh/km` efficiency into
    /// `Wh/mi` (`efficiency_wh_km * KM_PER_MILE`).
    static let kilometersPerMile = 1.609344

    /// Minutes per hour — the web duration split (`Math.floor(duration_min / 60)` + `duration_min % 60`).
    static let minutesPerHour = 60.0

    /// The em-dash the web slide shows for a missing address or a non-positive efficiency (web
    /// `start_address || '—'`, `efficiency_wh_km > 0 ? … : '—'`). Punctuation, not translatable prose —
    /// kept verbatim from the source literal.
    static let emDash = "—"
}

// MARK: - JavaScript numeric parity helpers

/// JavaScript `Math.round` parity: round half toward +∞ (`floor(x + 0.5)`), so 2.5 → 3 and -2.5 → -2.
/// The displayed distance/efficiency are non-negative in practice, but we port the exact semantics so
/// the equivalence holds for every input. Non-finite inputs collapse to 0 (web `safeNumber`).
func driveHighlightJSRound(_ value: Double) -> Int {
    let safe = value.isFinite ? value : 0
    return Int((safe + 0.5).rounded(.down))
}

/// Renders a `Double` the way JavaScript's `String(number)` / template interpolation does for the
/// duration parts: an integral value prints with no decimals (`5 → "5"`), a fractional value prints its
/// shortest round-tripping form. `duration_min` is an integer minute count in practice, so this yields
/// `"30"` rather than `"30.0"` to match the web `${mins}`.
func driveHighlightJSNumber(_ value: Double) -> String {
    let safe = value.isFinite ? value : 0
    if safe == safe.rounded() {
        return String(Int(safe))
    }
    return String(safe)
}

/// Distance converter ported 1:1 from `convertDistanceFromSI(meters, to)` in lib/unitConversion.ts — a
/// divide by the unit's metres-per-unit factor. Non-finite inputs collapse to 0 to match the web
/// `safeNumber` guard that wraps every displayed value.
func convertDriveHighlightDistanceFromSI(
    _ meters: Double,
    to unit: DriveHighlightSlideDistanceUnit
) -> Double {
    let safe = meters.isFinite ? meters : 0
    return safe / unit.metersPerUnit
}

// MARK: - Projection (web render values)

/// The fully-projected slide content: the route endpoints, the three stat figures with their units, and
/// the date — every value computed once per snapshot by the model with the exact same arithmetic +
/// formatting as the web slide. Plus a composed VoiceOver summary so the whole card reads as one spoken
/// sentence.
public struct DriveHighlightSlideProjection: Equatable {
    /// The slide's display label (web `label` prop), e.g. "Longest Drive" — spoken first in the
    /// VoiceOver summary and rendered uppercased above the card.
    public let label: String
    /// The start address, or the em-dash fallback when empty (web `start_address || '—'`).
    public let startAddress: String
    /// The end address, or the em-dash fallback when empty (web `end_address || '—'`).
    public let endAddress: String
    /// The rounded distance figure, plainly stringified (web `Math.round(distDisplay)`), e.g. "12500".
    public let distanceValue: String
    /// The distance unit symbol shown beneath the figure (`km` / `mi` / `ft`).
    public let distanceUnit: String
    /// The duration label (web `${hours}h ${mins}m` / `${mins}m`), e.g. "1h 30m" or "45m".
    public let durationText: String
    /// The rounded efficiency figure, or the em-dash fallback when `efficiency_wh_km <= 0`.
    public let efficiencyValue: String
    /// The efficiency unit (`Wh/mi` for miles, otherwise `Wh/km`).
    public let efficiencyUnit: String
    /// The drive date string, rendered verbatim (web `{drive.date}` — a pre-formatted backend string).
    public let date: String

    /// The composed VoiceOver summary for the whole card — the slide label, the route, the three stats,
    /// then the date, joined as one spoken sentence. Computed from the stored fields so it stays in sync.
    public var accessibilityLabel: String {
        DriveHighlightSlideProjector.accessibilitySummary(for: self)
    }

    public init(
        label: String,
        startAddress: String,
        endAddress: String,
        distanceValue: String,
        distanceUnit: String,
        durationText: String,
        efficiencyValue: String,
        efficiencyUnit: String,
        date: String
    ) {
        self.label = label
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.distanceValue = distanceValue
        self.distanceUnit = distanceUnit
        self.durationText = durationText
        self.efficiencyValue = efficiencyValue
        self.efficiencyUnit = efficiencyUnit
        self.date = date
    }
}

/// Pure projector: `DriveHighlightReviewDTO` + `DriveHighlightSlideUnitPrefs` + the slide `label` →
/// `DriveHighlightSlideProjection`. Every value is computed with the exact same arithmetic + formatting
/// as the web slide.
public enum DriveHighlightSlideProjector {
    public static func project(
        drive: DriveHighlightReviewDTO,
        units: DriveHighlightSlideUnitPrefs,
        label: String
    ) -> DriveHighlightSlideProjection {
        DriveHighlightSlideProjection(
            label: label,
            startAddress: address(drive.startAddress),
            endAddress: address(drive.endAddress),
            distanceValue: distance(drive: drive, units: units),
            distanceUnit: units.distance.symbol,
            durationText: duration(minutes: drive.durationMin),
            efficiencyValue: efficiency(drive: drive, units: units),
            efficiencyUnit: efficiencyUnit(for: units.distance),
            date: drive.date
        )
    }

    /// Web `address || '—'`: a blank/whitespace address collapses to the em-dash fallback.
    static func address(_ value: String) -> String {
        value.isEmpty ? DriveHighlightSlideConstants.emDash : value
    }

    /// Web `Math.round(convertDistanceFromSI(distance_km * 1000, distanceUnit))` rendered as a plain
    /// (ungrouped) string, exactly as React interpolates the rounded number.
    static func distance(drive: DriveHighlightReviewDTO, units: DriveHighlightSlideUnitPrefs) -> String {
        let meters = drive.distanceKm * DriveHighlightSlideConstants.metersPerKilometer
        let display = convertDriveHighlightDistanceFromSI(meters, to: units.distance)
        return String(driveHighlightJSRound(display))
    }

    /// Web duration split: `hours = floor(duration_min / 60)`, `mins = duration_min % 60`, then
    /// `hours > 0 ? "${hours}h ${mins}m" : "${mins}m"`.
    static func duration(minutes: Double) -> String {
        let safe = minutes.isFinite ? minutes : 0
        let hours = Int((safe / DriveHighlightSlideConstants.minutesPerHour).rounded(.down))
        let mins = safe - Double(hours) * DriveHighlightSlideConstants.minutesPerHour
        let minsText = driveHighlightJSNumber(mins)
        if hours > 0 {
            return "\(hours)h \(minsText)m"
        }
        return "\(minsText)m"
    }

    /// Web `efficiency_wh_km > 0 ? Math.round(effDisplay) : '—'`, where
    /// `effDisplay = distanceUnit === 'mi' ? efficiency_wh_km * KM_PER_MILE : efficiency_wh_km`.
    static func efficiency(drive: DriveHighlightReviewDTO, units: DriveHighlightSlideUnitPrefs) -> String {
        guard drive.efficiencyWhKm > 0 else {
            return DriveHighlightSlideConstants.emDash
        }
        let display = units.distance.usesImperialEfficiency
            ? drive.efficiencyWhKm * DriveHighlightSlideConstants.kilometersPerMile
            : drive.efficiencyWhKm
        return String(driveHighlightJSRound(display))
    }

    /// Web `efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'`, routed through the i18n facade.
    static func efficiencyUnit(for unit: DriveHighlightSlideDistanceUnit) -> String {
        unit.usesImperialEfficiency
            ? DriveHighlightSlideStrings.string("driveHighlight.efficiencyUnitMi", "Wh/mi")
            : DriveHighlightSlideStrings.string("driveHighlight.efficiencyUnitKm", "Wh/km")
    }

    /// Composes the spoken VoiceOver summary from a projection's visible pieces so the card reads as one
    /// coherent sentence: the slide label, the route, the three stats, then the date. The "duration"
    /// label and the "to" route connector are resolved through the i18n facade so the sentence localizes.
    static func accessibilitySummary(for projection: DriveHighlightSlideProjection) -> String {
        let toConnector = DriveHighlightSlideStrings.string("driveHighlight.routeTo", "to")
        let durationLabel = DriveHighlightSlideStrings.string("yearReview.duration", "duration")
        var parts: [String] = []
        if !projection.label.isEmpty {
            parts.append(projection.label)
        }
        parts.append("\(projection.startAddress) \(toConnector) \(projection.endAddress)")
        parts.append("\(projection.distanceValue) \(projection.distanceUnit)")
        parts.append("\(projection.durationText) \(durationLabel)")
        parts.append("\(projection.efficiencyValue) \(projection.efficiencyUnit)")
        if !projection.date.isEmpty {
            parts.append(projection.date)
        }
        return parts.joined(separator: ". ")
    }
}
