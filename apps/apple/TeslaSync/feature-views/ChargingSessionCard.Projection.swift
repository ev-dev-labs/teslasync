//
//  ChargingSessionCard.Projection.swift
//  TeslaSync — P4 feature view · 0107 · ChargingSessionCard (Apple)
//
//  The pure projection of a `ChargingSessionSummary` into every structural
//  decision the card renders — a direct port of the web component body (the `cat`,
//  `durationMin`, `avgRateKw`, `cpk`, `addedM`, `milesGained`, `energyKwh`,
//  `isFree`, `sessionScore`, and the badge/metric visibility branches). Pure +
//  `Equatable`, so the suite covers every configuration without a snapshot.
//

import Foundation

/// The structural projection the card view renders. Built once from a session +
/// the display-distance converter; the view reads it and never recomputes.
public struct ChargingSessionCardProjection: Equatable, Sendable {
    public var id: Int
    public var category: ChargerKind
    public var glow: ChargingSessionCardGlow
    public var durationMinutes: Double
    /// Average charge rate in kW (web `avgRateKw`): `avgPowerW / 1000` when > 0.
    public var avgRateKw: Double?
    public var costPerKwh: Double?
    public var energyKwh: Double
    public var isFree: Bool
    /// Peak power in kW (web `peak_power_w / 1000`) when present.
    public var peakPowerKw: Double?
    /// The raw session cost (web `session.cost_decimal`) — drives the cost metric
    /// (`cost_decimal > 0`) and is the source of `isFree`.
    public var costDecimal: Double?
    public var score: Double?
    /// The leading grade badge, present only when a score exists (web renders
    /// `<ScoreBadge>` only when `sessionScore != null`).
    public var scoreGrade: ChargingScoreGrade?
    /// Display-unit distance gained (web `milesGained` — `toDistanceDisplay(addedM/1000)`).
    public var distanceGainedDisplay: Double?
    public var startSocPct: Double?
    public var endSocPct: Double?
    public var startPlace: String?
    public var startLat: Double?
    public var startLng: Double?
    public var startedAt: Date?

    public init(
        id: Int,
        category: ChargerKind,
        glow: ChargingSessionCardGlow,
        durationMinutes: Double,
        avgRateKw: Double?,
        costPerKwh: Double?,
        energyKwh: Double,
        isFree: Bool,
        peakPowerKw: Double?,
        costDecimal: Double?,
        score: Double?,
        scoreGrade: ChargingScoreGrade?,
        distanceGainedDisplay: Double?,
        startSocPct: Double?,
        endSocPct: Double?,
        startPlace: String?,
        startLat: Double?,
        startLng: Double?,
        startedAt: Date?
    ) {
        self.id = id
        self.category = category
        self.glow = glow
        self.durationMinutes = durationMinutes
        self.avgRateKw = avgRateKw
        self.costPerKwh = costPerKwh
        self.energyKwh = energyKwh
        self.isFree = isFree
        self.peakPowerKw = peakPowerKw
        self.costDecimal = costDecimal
        self.score = score
        self.scoreGrade = scoreGrade
        self.distanceGainedDisplay = distanceGainedDisplay
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.startPlace = startPlace
        self.startLat = startLat
        self.startLng = startLng
        self.startedAt = startedAt
    }

    /// Whether the energy badge shows (web `energyKwh > 0`).
    public var showsEnergyBadge: Bool {
        energyKwh > 0
    }

    /// Whether the free badge shows (web `isFree && energyKwh > 0`).
    public var showsFreeBadge: Bool {
        isFree && energyKwh > 0
    }

    /// Whether the distance-gained chip shows (web `typeof milesGained === 'number'
    /// && milesGained > 0`).
    public var showsDistanceGained: Bool {
        guard let value = distanceGainedDisplay else { return false }
        return value > 0
    }

    /// Builds the projection from a session and the display-distance converter
    /// (web `toDistanceDisplay`, km → display unit). A faithful reproduction of the
    /// web component body.
    public static func make(
        session: ChargingSessionSummary,
        toDistanceDisplayKm: (Double) -> Double
    ) -> ChargingSessionCardProjection {
        let category = ChargerKind.category(forType: session.chargerType)
        let watts = ChargingSessionMetrics.avgPowerW(session)
        let addedM = ChargingSessionMetrics.distanceAddedM(session)
        let score = ChargingSessionMetrics.batteryFriendlyScore(
            startPct: session.startSocPct,
            endPct: session.endSocPct
        )
        let energyKwh = ChargingSessionNumeric.safe(session.totalEnergyAddedWh) / 1000
        return ChargingSessionCardProjection(
            id: session.id,
            category: category,
            glow: category.glow,
            durationMinutes: ChargingSessionMetrics.durationMinutes(session),
            avgRateKw: watts > 0 ? watts / 1000 : nil,
            costPerKwh: ChargingSessionMetrics.costPerKwh(session),
            energyKwh: energyKwh,
            isFree: session.costDecimal == nil || session.costDecimal == 0,
            peakPowerKw: session.peakPowerW.map { ChargingSessionNumeric.safe($0) / 1000 },
            costDecimal: session.costDecimal,
            score: score,
            scoreGrade: score.map { ChargingScoreGrade.grade(forScore: $0) },
            distanceGainedDisplay: addedM.map { toDistanceDisplayKm($0 / 1000) },
            startSocPct: session.startSocPct,
            endSocPct: session.endSocPct,
            startPlace: session.startPlace,
            startLat: session.startLat,
            startLng: session.startLng,
            startedAt: session.startedAt
        )
    }
}
