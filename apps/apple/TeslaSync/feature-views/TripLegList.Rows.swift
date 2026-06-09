//
//  TripLegList.Rows.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The resolved, view-ready row projection for the route breakdown — the pure
//  ("cached → projection") adapter the data state renders. `TripLegRowBuilder` is the
//  native port of the web component's `legItems.map((leg, idx) => …)` body, including
//  the `idx < stops.length` interleave rule that attaches a charge stop after a leg.
//  Everything here is Foundation-only so the row shapes, the interleave, and the
//  VoiceOver summary join are unit tested without a store or a rendered view.
//

import Foundation

// MARK: - Resolved rows (the view-ready projection of legs + interleaved stops)

/// A resolved charge stop shown after a leg — every value pre-formatted so the view is
/// a pure function of this struct. `durationMinutesValue` is the numeric part only; the
/// localized "min" suffix is applied at the view boundary (it is an i18n string).
public struct TripChargeStopRow: Equatable, Sendable {
    public let name: String
    public let durationMinutesValue: String
    public let socRangeText: String
    public let energyText: String
    public let costText: String
    public let isRecommended: Bool

    public init(
        name: String,
        durationMinutesValue: String,
        socRangeText: String,
        energyText: String,
        costText: String,
        isRecommended: Bool
    ) {
        self.name = name
        self.durationMinutesValue = durationMinutesValue
        self.socRangeText = socRangeText
        self.energyText = energyText
        self.costText = costText
        self.isRecommended = isRecommended
    }
}

/// A resolved leg row — the header labels, the four pre-formatted metrics, and the
/// optional charge stop interleaved after it. `arrivalSocLow` selects the danger vs
/// warning tint for the arrival SOC (web `arrival_soc < 20`).
public struct TripLegRow: Equatable, Sendable, Identifiable {
    public let id: Int
    public let index: Int
    public let fromLabel: String
    public let toLabel: String
    public let distanceText: String
    public let durationMinutesValue: String
    public let energyText: String
    public let startSocText: String
    public let arrivalSocText: String
    public let arrivalSocLow: Bool
    public let chargeStop: TripChargeStopRow?

    public init(
        index: Int,
        fromLabel: String,
        toLabel: String,
        distanceText: String,
        durationMinutesValue: String,
        energyText: String,
        startSocText: String,
        arrivalSocText: String,
        arrivalSocLow: Bool,
        chargeStop: TripChargeStopRow?
    ) {
        id = index
        self.index = index
        self.fromLabel = fromLabel
        self.toLabel = toLabel
        self.distanceText = distanceText
        self.durationMinutesValue = durationMinutesValue
        self.energyText = energyText
        self.startSocText = startSocText
        self.arrivalSocText = arrivalSocText
        self.arrivalSocLow = arrivalSocLow
        self.chargeStop = chargeStop
    }
}

// MARK: - Row builder (web `legItems.map((leg, idx) => …)` + interleave)

/// Builds the resolved rows from raw legs + charge stops — the native port of the web
/// component's `legItems.map((leg, idx) => …)` body, including the interleave rule
/// `idx < stops.length` that attaches the charge stop after each leg. Unit tested.
public enum TripLegRowBuilder {
    public static func build(
        legs: [TripLegData],
        chargeStops: [TripChargeStopData],
        config: TripLegFormatConfig
    ) -> [TripLegRow] {
        legs.enumerated().map { idx, leg in
            TripLegRow(
                index: idx + 1,
                fromLabel: TripLegFormat.locationLabel(leg.from),
                toLabel: TripLegFormat.locationLabel(leg.to),
                distanceText: TripLegFormat.distanceText(meters: leg.distanceM, config: config),
                durationMinutesValue: "\(TripLegFormat.jsRound(leg.durationS))",
                energyText: TripLegFormat.energyText(wh: leg.energyWh, config: config),
                startSocText: TripLegFormat.socText(leg.startSoc),
                arrivalSocText: TripLegFormat.socText(leg.arrivalSoc),
                arrivalSocLow: leg.arrivalSoc < TripLegConstants.lowArrivalSocThreshold,
                chargeStop: idx < chargeStops.count ? stopRow(chargeStops[idx], config: config) : nil
            )
        }
    }

    private static func stopRow(_ stop: TripChargeStopData, config: TripLegFormatConfig) -> TripChargeStopRow {
        let minutes = TripLegFormat.jsRound(stop.chargeDurationS / TripLegConstants.secondsPerMinute)
        return TripChargeStopRow(
            name: stop.name,
            durationMinutesValue: "\(minutes)",
            socRangeText: TripLegFormat.socRangeText(from: stop.chargeFromSoc, to: stop.chargeToSoc),
            energyText: TripLegFormat.energyText(wh: stop.energyWh, config: config),
            costText: TripLegFormat.currencyText(amount: stop.cost, config: config),
            isRecommended: stop.isRecommended
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the VoiceOver strings for the route breakdown from already-localized parts,
/// so the spoken content is asserted without rendering the view (mirrors the
/// AchievementBadge a11y seam). The view supplies the localized label/value segments.
public enum TripLegAccessibility {
    /// Joins the supplied segments with ", ", dropping any empties — the composed
    /// spoken label for a leg row or a charge stop.
    public static func summary(_ parts: [String]) -> String {
        parts
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}
