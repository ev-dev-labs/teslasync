//
//  DriveScore.Projection.swift
//  TeslaSync — P4 shared surface · 0082 · DriveScore (Apple)
//
//  The pure projection from the drive props to the view-ready model the SwiftUI body renders — the
//  verbatim port of the web `computeDriveScore` + `getScoreColor`. The web component folds a
//  `(distance, duration, maxSpeed, startSoC, endSoC)` tuple into a total 0–100 score plus four
//  weighted sub-scores; this projection bakes the same arithmetic into a ``DriveScoreSurfaceProjection``
//  whose `total` is the rounded clamp of the UNROUNDED component sum (NOT the sum of the rounded
//  parts — the web rounds the parts and the total independently, so they can differ by a point), whose
//  per-axis `breakdown` carries the rounded sub-scores + their fill fractions, and whose `band` is the
//  web `getScoreColor` classification. The view is a pure function of this value; every branch is unit
//  tested against values cross-checked with the web JS.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for:
//  ``DriveScoreSurfaceProjector/compute(_:)`` takes the cached SI drive fields (what a drive row
//  already holds) and derives the rendered score — no networking, no clock.
//

import Foundation

// MARK: - DriveScoreSurfaceBreakdownItem (web breakdown row)

/// One resolved breakdown row — the native bundle of a web `{ label, value, max, color }` entry minus
/// the color (which is token-driven in the view). `value` is the rounded sub-score, `maxPoints` its
/// ceiling, and `fraction` the clamped `value / maxPoints` the bar fills to (web `width:
/// (value / max) * 100%`).
public struct DriveScoreSurfaceBreakdownItem: Sendable, Equatable, Identifiable {
    /// The axis this row scores; doubles as the `ForEach` identity.
    public let category: DriveScoreSurfaceCategory
    /// The rounded sub-score (web `Math.round` of the axis component).
    public let value: Int
    /// The axis point ceiling (web `max`).
    public let maxPoints: Int

    public var id: String {
        category.id
    }

    /// The clamped bar fill 0…1 — web `(value / max) * 100%`.
    public var fraction: Double {
        guard maxPoints > 0 else { return 0 }
        return min(max(Double(value) / Double(maxPoints), 0), 1)
    }

    public init(category: DriveScoreSurfaceCategory, value: Int, maxPoints: Int) {
        self.category = category
        self.value = value
        self.maxPoints = maxPoints
    }
}

// MARK: - DriveScoreSurfaceProjection (web `computeDriveScore` output)

/// The resolved, view-ready score — the native bundle of everything the web `computeDriveScore` +
/// `getScoreColor` decide. `total` drives the gauge (and its `fillFraction`), `band` colors it, and
/// `breakdown` is the four ordered axis rows. `efficiency` / `speed` / `range` / `trip` are also kept
/// flat for ergonomic test assertions (they equal the `breakdown` values, in source order).
public struct DriveScoreSurfaceProjection: Sendable, Equatable {
    /// The overall 0–100 score (web `total`, the rounded clamp of the unrounded component sum).
    public let total: Int
    /// The rounded efficiency sub-score 0–40 (web `efficiency`).
    public let efficiency: Int
    /// The rounded speed-discipline sub-score 0–20 (web `speed`).
    public let speed: Int
    /// The rounded range-preservation sub-score 0–20 (web `range`).
    public let range: Int
    /// The rounded trip-length sub-score 0–20 (web `trip`).
    public let trip: Int
    /// The quality band coloring the gauge (web `getScoreColor`).
    public let band: DriveScoreSurfaceBand
    /// The four breakdown rows, in source order (efficiency, speed, range, trip).
    public let breakdown: [DriveScoreSurfaceBreakdownItem]

    /// The gauge arc fill 0…1 — web `score.total / 100`.
    public var fillFraction: Double {
        let ceiling = Double(DriveScoreSurfaceConstants.maxTotalScore)
        guard ceiling > 0 else { return 0 }
        return min(max(Double(total) / ceiling, 0), 1)
    }

    public init(
        total: Int,
        efficiency: Int,
        speed: Int,
        range: Int,
        trip: Int,
        band: DriveScoreSurfaceBand,
        breakdown: [DriveScoreSurfaceBreakdownItem]
    ) {
        self.total = total
        self.efficiency = efficiency
        self.speed = speed
        self.range = range
        self.trip = trip
        self.band = band
        self.breakdown = breakdown
    }
}

// MARK: - Projection (props → resolved)

/// Pure projection to the view-ready score — the verbatim port of the web `computeDriveScore`. Kept
/// as a pure function over the caller-owned SI fields so every branch (populated, empty, zero
/// duration, absent max speed, fractional SoC) is unit tested without an `@Observable` model or a
/// view.
public enum DriveScoreSurfaceProjector {
    /// Resolves the score exactly like the web `computeDriveScore`:
    ///   • efficiency (40 pts) rewards proximity to 150 Wh/km, derived from SoC used per km;
    ///   • speed (20 pts) is `20 × avg/max` speed ratio (smooth driving scores higher);
    ///   • range (20 pts) rewards low SoC drain per km (best 0.1 %/km → worst 1 %/km);
    ///   • trip (20 pts) scales linearly with distance, plateauing at 50 km.
    /// The absent-field `?? default` chain matches the web nullish-coalescing, and `total` is the
    /// rounded clamp of the UNROUNDED sum (the parts are rounded separately), so it can differ from
    /// the sum of the displayed sub-scores by a point — exactly as the web does.
    public static func compute(_ inputs: DriveScoreSurfaceInputs) -> DriveScoreSurfaceProjection {
        let constants = DriveScoreSurfaceConstants.self

        let distanceM = finite(inputs.distanceM) ?? 0
        let distanceKm = distanceM / constants.metersPerKm
        let durationS = finite(inputs.durationS) ?? 0
        let avgSpeedMps = durationS > 0 ? distanceM / durationS : 0
        let maxSpeedMps = finite(inputs.maxSpeedMps) ?? avgSpeedMps
        let startBattery = finite(inputs.startBatteryPct) ?? constants.defaultStartBatteryPct
        let endBattery = finite(inputs.endBatteryPct) ?? startBattery

        let efficiency = efficiencyComponent(distanceKm: distanceKm, startBattery: startBattery, endBattery: endBattery)
        let speed = speedComponent(avgSpeedMps: avgSpeedMps, maxSpeedMps: maxSpeedMps)
        let rangeScore = rangeComponent(distanceKm: distanceKm, startBattery: startBattery, endBattery: endBattery)
        let tripScore = tripComponent(distanceKm: distanceKm)

        let summed = efficiency + speed + rangeScore + tripScore
        let total = jsRound(clamp(summed, 0, Double(constants.maxTotalScore)))
        let perCategory: [(DriveScoreSurfaceCategory, Int)] = [
            (.efficiency, jsRound(efficiency)),
            (.speedDiscipline, jsRound(speed)),
            (.rangePreservation, jsRound(rangeScore)),
            (.tripLength, jsRound(tripScore))
        ]
        let breakdown = perCategory.map { category, value in
            DriveScoreSurfaceBreakdownItem(category: category, value: value, maxPoints: category.maxPoints)
        }

        return DriveScoreSurfaceProjection(
            total: total,
            efficiency: perCategory[0].1,
            speed: perCategory[1].1,
            range: perCategory[2].1,
            trip: perCategory[3].1,
            band: .classify(total: total),
            breakdown: breakdown
        )
    }

    // MARK: Axis components (web inline arithmetic, one helper each)

    /// Efficiency (40 pts): closer to the 150 Wh/km optimum scores higher.
    private static func efficiencyComponent(distanceKm: Double, startBattery: Double, endBattery: Double) -> Double {
        let constants = DriveScoreSurfaceConstants.self
        let batteryUsed = max(startBattery - endBattery, 0)
        let whPerKm = distanceKm > 0
            ? (batteryUsed * constants.usableBatteryWhPerPercent) / distanceKm
            : constants.fallbackWhPerKm
        let deviation = abs(whPerKm - constants.optimalWhPerKm) / constants.optimalWhPerKm
        let maxPoints = Double(constants.efficiencyMaxPoints)
        return clamp(maxPoints * (1 - deviation), 0, maxPoints)
    }

    /// Speed discipline (20 pts): the avg/max speed ratio — smooth driving scores higher.
    private static func speedComponent(avgSpeedMps: Double, maxSpeedMps: Double) -> Double {
        let constants = DriveScoreSurfaceConstants.self
        let ratio = maxSpeedMps > 0 ? avgSpeedMps / maxSpeedMps : constants.fallbackSpeedRatio
        let maxPoints = Double(constants.speedMaxPoints)
        return clamp(maxPoints * ratio, 0, maxPoints)
    }

    /// Range preservation (20 pts): less SoC drain per km scores higher.
    private static func rangeComponent(distanceKm: Double, startBattery: Double, endBattery: Double) -> Double {
        let constants = DriveScoreSurfaceConstants.self
        let batteryUsed = max(startBattery - endBattery, 0)
        let batteryPerKm = distanceKm > 0 ? batteryUsed / distanceKm : constants.fallbackBatteryPerKm
        let normalized = 1 - (batteryPerKm - constants.rangeBestPerKm) / constants.rangeSpanPerKm
        let maxPoints = Double(constants.rangeMaxPoints)
        return clamp(maxPoints * normalized, 0, maxPoints)
    }

    /// Trip length (20 pts): longer trips score higher, plateauing at 50 km.
    private static func tripComponent(distanceKm: Double) -> Double {
        let constants = DriveScoreSurfaceConstants.self
        let maxPoints = Double(constants.tripMaxPoints)
        return clamp(maxPoints * min(distanceKm / constants.tripPlateauKm, 1), 0, maxPoints)
    }

    // MARK: Numeric helpers (web `clamp` / `Math.round`)

    /// The web `clamp(v, min, max)` = `Math.max(min, Math.min(max, v))`.
    private static func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
        max(lower, min(upper, value))
    }

    /// The web `Math.round` over the surface's non-negative, clamped domain. `Double.rounded()` uses
    /// to-nearest-ties-away-from-zero which, for non-negative values, equals JS round-half-up. A
    /// non-finite input (impossible here — every value is clamped first) collapses to 0 rather than
    /// trapping `Int(_:)`.
    private static func jsRound(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return Int(value.rounded())
    }

    /// Maps a non-finite `Double?` to the absent (`nil`) case so the `?? default` chain behaves; a
    /// finite value passes through unchanged.
    private static func finite(_ value: Double?) -> Double? {
        guard let value, value.isFinite else { return nil }
        return value
    }
}
