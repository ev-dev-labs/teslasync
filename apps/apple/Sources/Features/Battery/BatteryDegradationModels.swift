import Foundation

// Value types + pure derivations for the Battery Degradation surface (web
// `BatteryDegradationPage.tsx`, route `/battery-degradation`). Every measurement
// stays SI exactly as the API serves it — state-of-health is a raw percent, range
// and odometer are kilometres of derived SI, capacity is watt-hours — and the
// user's unit preference is applied only at the SwiftUI render boundary (ADR-005).
// Field names mirror the snake_case wire (`current_soh`, `soh_pct`, `range_km`)
// so the production KMP-backed data source maps straight across. Every derivation
// the web page computes with `useMemo` (range series, projection series, charge
// habit ratios, cycle-depth score) lives here as a pure, unit-tested function.

// MARK: - Stress level (web `degradation.stress_level` 'Low' | 'Medium' | 'High')

/// The pack's charging-stress classification (web `stress_level`). Unknown / missing
/// wire values degrade to `.unknown` (web `?? 'Unknown'`) rather than throwing.
public enum BatteryStressLevel: String, CaseIterable, Sendable {
    case low = "Low"
    case medium = "Medium"
    case high = "High"
    case unknown = "Unknown"

    /// Builds a level from the wire string, defaulting unknown values to `.unknown`.
    public static func from(_ raw: String?) -> BatteryStressLevel {
        guard let raw else { return .unknown }
        return BatteryStressLevel(rawValue: raw) ?? .unknown
    }

    /// Web color map: Low → success, Medium → warning, High / Unknown → danger.
    public var severity: BatterySeverity {
        switch self {
        case .low: .success
        case .medium: .warning
        case .high, .unknown: .danger
        }
    }

    /// The raw label the web renders verbatim (`degradation.stress_level`).
    public var displayLabel: String {
        rawValue
    }

    /// Guidance i18n key shown in the charging-impact banner body (web
    /// `stressLow` / `stressMedium` / `stressHigh`; unknown falls back to high).
    public var guidanceKey: String {
        switch self {
        case .low: "battery.degradation.stressLow"
        case .medium: "battery.degradation.stressMedium"
        case .high, .unknown: "battery.degradation.stressHigh"
        }
    }
}

// MARK: - Score severity (web `scoreVariant` / `riskBadgeVariant`)

/// Pure score → severity bands shared by the health-factor badges and the risk
/// gauges, kept SwiftUI-free so they are unit-testable (mapped to tones in views).
public enum BatteryDegradationScore {
    /// Web `scoreVariant`: ≥ 80 success, ≥ 50 warning, else danger.
    public static func variant(_ score: Double) -> BatterySeverity {
        if score >= 80 { return .success }
        if score >= 50 { return .warning }
        return .danger
    }

    /// Web `riskBadgeVariant` / `riskScoreColor`: ≤ 25 success, ≤ 50 warning, else danger.
    public static func risk(_ score: Int) -> BatterySeverity {
        if score <= 25 { return .success }
        if score <= 50 { return .warning }
        return .danger
    }

    /// Web SOH band: > 90 success, ≥ 80 warning, else danger (gauge + history badge).
    public static func soh(_ soh: Double) -> BatterySeverity {
        if soh > 90 { return .success }
        if soh >= 80 { return .warning }
        return .danger
    }

    /// Web SOH band label key: > 90 "Excellent", ≥ 80 "Good", else "Degraded".
    public static func sohBandKey(_ soh: Double) -> String {
        if soh > 90 { return "Excellent" }
        if soh >= 80 { return "Good" }
        return "Degraded"
    }
}

// MARK: - Battery health snapshot (web `BatteryHealthSnapshot`)

/// One historical health sample (web `BatteryHealthSnapshot`). `date` is the raw
/// wire date; `odometerKm` / `rangeKm` are kilometres of derived SI; `capacityWh`
/// is watt-hours — all converted to the user's unit only at the render boundary.
public struct BatteryHealthSnapshot: Identifiable, Hashable, Sendable {
    public let date: String
    public let odometerKm: Double
    public let sohPct: Double
    public let capacityWh: Double
    public let rangeKm: Double

    public var id: String {
        "\(date)-\(odometerKm)"
    }

    public init(date: String, odometerKm: Double, sohPct: Double, capacityWh: Double, rangeKm: Double) {
        self.date = date
        self.odometerKm = odometerKm
        self.sohPct = sohPct
        self.capacityWh = capacityWh
        self.rangeKm = rangeKm
    }

    /// Web history-table SOH badge band (> 90 success / ≥ 80 warning / else danger).
    public var sohSeverity: BatterySeverity {
        BatteryDegradationScore.soh(sohPct)
    }
}

// MARK: - Battery health analytics (web `BatteryHealthAnalytics` → /analytics/battery-health)

/// The primary per-vehicle health snapshot (web `useBatteryHealthAnalytics` `data`).
/// Its presence drives the page's loading / empty / error / success phases. Holds
/// the overview scalars (SOH, capacity, degradation rate, age, cycles, scores) and
/// the historical envelope, plus the pure derivations the web page computes inline.
public struct BatteryHealthData: Hashable, Sendable {
    public let currentSoh: Double
    public let estimatedCapacityKwh: Double
    public let degradationRateYr: Double
    public let batteryAgeMonths: Int
    public let totalCycles: Int
    public let avgDepthOfDischarge: Double
    public let fastChargePct: Double
    public let fullChargePct: Double
    public let chargeHabitsScore: Double
    public let tempExposureScore: Double
    public let history: [BatteryHealthSnapshot]

    public init(
        currentSoh: Double,
        estimatedCapacityKwh: Double,
        degradationRateYr: Double,
        batteryAgeMonths: Int,
        totalCycles: Int,
        avgDepthOfDischarge: Double,
        fastChargePct: Double,
        fullChargePct: Double,
        chargeHabitsScore: Double,
        tempExposureScore: Double,
        history: [BatteryHealthSnapshot]
    ) {
        self.currentSoh = currentSoh
        self.estimatedCapacityKwh = estimatedCapacityKwh
        self.degradationRateYr = degradationRateYr
        self.batteryAgeMonths = batteryAgeMonths
        self.totalCycles = totalCycles
        self.avgDepthOfDischarge = avgDepthOfDischarge
        self.fastChargePct = fastChargePct
        self.fullChargePct = fullChargePct
        self.chargeHabitsScore = chargeHabitsScore
        self.tempExposureScore = tempExposureScore
        self.history = history
    }

    /// Web `cycleDepthScore` = `max(0, round(100 - avg_depth_of_discharge))`.
    public var cycleDepthScore: Double {
        max(0, (100 - avgDepthOfDischarge).rounded())
    }

    /// Web `current_soh` band severity for the gauge tint + badge.
    public var sohSeverity: BatterySeverity {
        BatteryDegradationScore.soh(currentSoh)
    }

    /// Web gauge badge label key ("Excellent" / "Good" / "Degraded").
    public var sohBandKey: String {
        BatteryDegradationScore.sohBandKey(currentSoh)
    }

    /// Whether any history exists — gates the range chart + history table (web
    /// `rangeData.length > 0` / `data?.history && length > 0`).
    public var hasHistory: Bool {
        !history.isEmpty
    }

    /// Web `rangeData` useMemo — original (history[0]) vs current range per sample.
    public var rangeRows: [BatteryRangeRow] {
        guard let original = history.first?.rangeKm else { return [] }
        return history.enumerated().map { index, snapshot in
            BatteryRangeRow(
                index: index,
                label: BatteryDegradationFormat.dateLabel(snapshot.date),
                originalKm: original,
                currentKm: snapshot.rangeKm
            )
        }
    }
}

// MARK: - Predictive projection (web `PredictiveProjection`)

/// One projected future health point with its confidence interval (web
/// `PredictiveProjection`). `date` is the raw wire label; all values are percents.
public struct BatteryProjectionPoint: Hashable, Sendable {
    public let date: String
    public let healthPct: Double
    public let confidenceLow: Double
    public let confidenceHigh: Double

    public init(date: String, healthPct: Double, confidenceLow: Double, confidenceHigh: Double) {
        self.date = date
        self.healthPct = healthPct
        self.confidenceLow = confidenceLow
        self.confidenceHigh = confidenceHigh
    }
}

// MARK: - Charging habits (web `ChargingHabits`)

/// Charge-event tallies used by the charging-impact banner (web `charging_habits`).
public struct BatteryChargingHabits: Hashable, Sendable {
    public let fastChargeCount: Int
    public let slowChargeCount: Int
    public let deepDischargeCount: Int

    public init(fastChargeCount: Int, slowChargeCount: Int, deepDischargeCount: Int) {
        self.fastChargeCount = fastChargeCount
        self.slowChargeCount = slowChargeCount
        self.deepDischargeCount = deepDischargeCount
    }

    /// Web `totalCharges = fast_charge_count + slow_charge_count`.
    public var totalCharges: Int {
        fastChargeCount + slowChargeCount
    }

    /// Web `fastChargePct = fmtInt(total > 0 ? fast/total*100 : 0)`.
    public var fastChargePercent: Int {
        guard totalCharges > 0 else { return 0 }
        return Int((Double(fastChargeCount) / Double(totalCharges) * 100).rounded())
    }
}

// MARK: - Degradation prediction (web `DegradationPrediction`)

/// The linear-fit prediction block (web `degradation.prediction`). `hasEnoughData`
/// gates the populated prediction vs. the "need more data" callout.
public struct BatteryDegradationPrediction: Hashable, Sendable {
    public let hasEnoughData: Bool
    public let slopePerYear: Double
    public let yearsTo80Pct: Double
    public let predictedDate: String?

    public init(hasEnoughData: Bool, slopePerYear: Double, yearsTo80Pct: Double, predictedDate: String?) {
        self.hasEnoughData = hasEnoughData
        self.slopePerYear = slopePerYear
        self.yearsTo80Pct = yearsTo80Pct
        self.predictedDate = predictedDate
    }
}

// MARK: - Risk factor (web `RiskFactorData`)

/// One scored degradation risk factor (web `RiskFactorData`): the wire `name`, a
/// 0…100 `score`, a backend `label` + `detail`, plus the icon + severity the card
/// renders (web `riskFactorIcon` / `riskBadgeVariant`).
public struct BatteryRiskFactor: Identifiable, Hashable, Sendable {
    public let name: String
    public let score: Int
    public let label: String
    public let detail: String

    public var id: String {
        name
    }

    public init(name: String, score: Int, label: String, detail: String) {
        self.name = name
        self.score = score
        self.label = label
        self.detail = detail
    }

    /// Web `riskBadgeVariant(score)` / `riskScoreColor(score)`.
    public var severity: BatterySeverity {
        BatteryDegradationScore.risk(score)
    }

    /// Web `riskFactorIcon(name)` mapped to SF Symbols.
    public var systemImage: String {
        switch name {
        case "fast_charge_ratio": "bolt.fill"
        case "high_soc_charging": "battery.100"
        case "temperature_exposure": "thermometer.medium"
        case "cycle_count_rate": "waveform.path.ecg"
        case "deep_discharge_frequency": "chart.line.downtrend.xyaxis"
        default: "shield.fill"
        }
    }

    /// Web `rf.name.replace(/_/g, ' ')` — the humanized fallback label (the per-name
    /// `battery.degradation.risk.*` key defaults to this in the web source).
    public var humanizedName: String {
        name.replacingOccurrences(of: "_", with: " ")
    }
}

// MARK: - Degradation detail (web `DegradationData` → /analytics/battery-degradation)

/// The supplementary degradation snapshot (web `useBatteryDegradation` `degradation`).
/// Optional — its absence simply yields the prediction / risk / recommendation
/// empty states while the page stays driven by the primary health source.
public struct BatteryDegradationDetail: Hashable, Sendable {
    public let projections: [BatteryProjectionPoint]
    public let prediction: BatteryDegradationPrediction?
    public let chargingHabits: BatteryChargingHabits?
    public let stressLevel: BatteryStressLevel
    public let currentCycles: Int
    public let riskFactors: [BatteryRiskFactor]
    public let recommendations: [String]

    public init(
        projections: [BatteryProjectionPoint],
        prediction: BatteryDegradationPrediction?,
        chargingHabits: BatteryChargingHabits?,
        stressLevel: BatteryStressLevel,
        currentCycles: Int,
        riskFactors: [BatteryRiskFactor],
        recommendations: [String]
    ) {
        self.projections = projections
        self.prediction = prediction
        self.chargingHabits = chargingHabits
        self.stressLevel = stressLevel
        self.currentCycles = currentCycles
        self.riskFactors = riskFactors
        self.recommendations = recommendations
    }
}
