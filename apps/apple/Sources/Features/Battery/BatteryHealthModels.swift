import Foundation

// Value types for the Battery Health surface (web
// `web/src/features/battery/pages/BatteryHealthPage.tsx`, route `/battery`). Every
// measurement stays SI exactly as the API serves it — state-of-health is a raw
// percent, range is kilometres of derived SI, capacity is kWh as the analytics
// endpoint serves it, module temperatures are SI Celsius, session energy is
// watt-hours — and the user's unit preference is applied only at the SwiftUI render
// boundary (ADR-005). Field names mirror the snake_case wire (`current_soh`,
// `range_km`, `module_temp_max`, `total_energy_added_wh`) so the production
// KMP-backed data source maps straight across. Distinct type names (…`Analytics`,
// …`HistoryPoint`, …`ChargingSession`, …`Live`) avoid colliding with the sibling
// Battery Degradation `BatteryHealthData` / `BatteryHealthSnapshot` symbols.

// MARK: - Health-band severity bands (web `gaugeColor` / `healthVariant` / `healthLabel`)

/// Pure state-of-health band thresholds shared by the gauge tint, the band badge,
/// and the summary cards (web `healthVariant` / `healthLabel` / `gaugeColor`). Kept
/// SwiftUI-free so it is unit-testable; mapped to tones/palette at the boundary.
public enum BatteryHealthBand {
    /// Web `healthVariant`: ≥ 90 success, ≥ 70 warning, else danger.
    public static func severity(_ soh: Double) -> BatterySeverity {
        if soh >= 90 { return .success }
        if soh >= 70 { return .warning }
        return .danger
    }

    /// Web `healthLabel` key: ≥ 90 Excellent, ≥ 70 Good, else Degraded.
    public static func labelKey(_ soh: Double) -> String {
        if soh >= 90 { return "battery.health.excellent" }
        if soh >= 70 { return "battery.health.good" }
        return "battery.health.degraded"
    }

    /// Web `gaugeColor`: ≥ 90 green (palette 2), ≥ 70 amber (palette 1), else red (palette 5).
    public static func colorIndex(_ soh: Double) -> Int {
        if soh >= 90 { return 2 }
        if soh >= 70 { return 1 }
        return 5
    }

    /// Web `degradationColor`: ≤ 5 green, ≤ 15 amber, else red (annual %/yr rate).
    public static func degradationColorIndex(_ pct: Double) -> Int {
        if pct <= 5 { return 2 }
        if pct <= 15 { return 1 }
        return 5
    }
}

// MARK: - Health history point (web `BatteryHealthAnalytics['history'][n]`)

/// One historical health sample (web `history` entry). `date` is the raw wire date;
/// `rangeKm` is kilometres of derived SI converted to the user's unit only at the
/// render boundary; `sohPct` is a raw percent.
public struct BatteryHealthHistoryPoint: Identifiable, Hashable, Sendable {
    public let date: String
    public let sohPct: Double
    public let rangeKm: Double

    public var id: String {
        date
    }

    public init(date: String, sohPct: Double, rangeKm: Double) {
        self.date = date
        self.sohPct = sohPct
        self.rangeKm = rangeKm
    }
}

// MARK: - Battery health analytics (web `BatteryHealthAnalytics` → /analytics/battery-health)

/// The primary per-vehicle health snapshot (web `useBatteryHealthAnalytics` `data`).
/// Its presence drives the page's loading / empty / error / success phases. Holds the
/// overview scalars (SOH, current + original capacity, degradation rate, age, cycles,
/// charge-habit percents) and the historical envelope.
public struct BatteryHealthAnalytics: Hashable, Sendable {
    public let currentSoh: Double
    public let estimatedCapacityKwh: Double
    public let originalCapacityKwh: Double
    public let degradationRateYr: Double
    public let batteryAgeMonths: Int
    public let totalCycles: Int
    public let avgDepthOfDischarge: Double
    public let fastChargePct: Double
    public let fullChargePct: Double
    public let history: [BatteryHealthHistoryPoint]

    public init(
        currentSoh: Double,
        estimatedCapacityKwh: Double,
        originalCapacityKwh: Double,
        degradationRateYr: Double,
        batteryAgeMonths: Int,
        totalCycles: Int,
        avgDepthOfDischarge: Double,
        fastChargePct: Double,
        fullChargePct: Double,
        history: [BatteryHealthHistoryPoint]
    ) {
        self.currentSoh = currentSoh
        self.estimatedCapacityKwh = estimatedCapacityKwh
        self.originalCapacityKwh = originalCapacityKwh
        self.degradationRateYr = degradationRateYr
        self.batteryAgeMonths = batteryAgeMonths
        self.totalCycles = totalCycles
        self.avgDepthOfDischarge = avgDepthOfDischarge
        self.fastChargePct = fastChargePct
        self.fullChargePct = fullChargePct
        self.history = history
    }

    /// Web capacity gauge value `clamp(0, 100, estimated / original * 100)`.
    public var capacityPercent: Double {
        guard originalCapacityKwh > 0 else { return 0 }
        return min(max((estimatedCapacityKwh / originalCapacityKwh) * 100, 0), 100)
    }

    /// Web metric bar value `round(estimated / original * 100)`.
    public var capacityBarValue: Double {
        guard originalCapacityKwh > 0 else { return 0 }
        return (estimatedCapacityKwh / originalCapacityKwh * 100).rounded()
    }

    /// Web `healthVariant(current_soh)` band.
    public var healthSeverity: BatterySeverity {
        BatteryHealthBand.severity(currentSoh)
    }

    /// Web `healthLabel(current_soh)` band key.
    public var healthBandKey: String {
        BatteryHealthBand.labelKey(currentSoh)
    }

    /// Web `gaugeColor(current_soh)` palette index.
    public var healthColorIndex: Int {
        BatteryHealthBand.colorIndex(currentSoh)
    }

    /// Web `degradationColor(degradation_rate_yr)` palette index.
    public var degradationColorIndex: Int {
        BatteryHealthBand.degradationColorIndex(degradationRateYr)
    }

    /// Web `data.history && length > 0` — gates the range chart + new-vs-now ranges.
    public var hasHistory: Bool {
        !history.isEmpty
    }
}

// MARK: - Degradation projection (web `useBatteryDegradation` `degradation`)

/// One projected future health point (web `degradation.prediction.projection_points[n]`).
/// `month` is the raw `YYYY-MM` wire label; `healthPct` is a percent.
public struct BatteryHealthProjectionPoint: Hashable, Sendable {
    public let month: String
    public let healthPct: Double

    public init(month: String, healthPct: Double) {
        self.month = month
        self.healthPct = healthPct
    }
}

/// The linear-fit prediction block (web `degradation.prediction`). The supplementary
/// degradation source is independent of the page phase: its absence simply yields the
/// not-enough-data empty state for the capacity-trend projection.
public struct BatteryHealthPrediction: Hashable, Sendable {
    public let hasEnoughData: Bool
    public let slopePerYear: Double
    public let yearsTo80Pct: Double?
    public let projectionPoints: [BatteryHealthProjectionPoint]

    public init(
        hasEnoughData: Bool,
        slopePerYear: Double,
        yearsTo80Pct: Double?,
        projectionPoints: [BatteryHealthProjectionPoint]
    ) {
        self.hasEnoughData = hasEnoughData
        self.slopePerYear = slopePerYear
        self.yearsTo80Pct = yearsTo80Pct
        self.projectionPoints = projectionPoints
    }

    /// Web `projectionTrustworthy`: enough data, finite slope ≤ 50 %/yr, and a finite
    /// positive years-to-80 %. Guards against absurd short-window regression slopes.
    public var isTrustworthy: Bool {
        guard hasEnoughData else { return false }
        let slope = abs(slopePerYear)
        guard slope.isFinite, slope <= 50 else { return false }
        guard let years = yearsTo80Pct, years.isFinite, years > 0 else { return false }
        return true
    }
}

// MARK: - Charging session (web `ChargingSession` subset used here)

/// One paginated charging session (web `useChargingSessionsPaginated` row) used by the
/// charge-level distribution, the charging-habit tiles, and the AC/DC breakdown.
/// `totalEnergyAddedWh` is watt-hours of SI; `peakPowerW` is watts.
public struct BatteryHealthChargingSession: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let startSocPct: Double
    public let endSocPct: Double?
    public let chargerType: String?
    public let peakPowerW: Double?
    public let totalEnergyAddedWh: Double?

    public init(
        id: Int64,
        startSocPct: Double,
        endSocPct: Double?,
        chargerType: String?,
        peakPowerW: Double?,
        totalEnergyAddedWh: Double?
    ) {
        self.id = id
        self.startSocPct = startSocPct
        self.endSocPct = endSocPct
        self.chargerType = chargerType
        self.peakPowerW = peakPowerW
        self.totalEnergyAddedWh = totalEnergyAddedWh
    }

    /// Web `isDC = (charger_type?.length > 0) || (peak_power_w > 20_000)`.
    public var isDC: Bool {
        if let type = chargerType, !type.isEmpty { return true }
        return (peakPowerW ?? 0) > 20_000
    }

    /// Web `charger_type?.toLowerCase().includes('tesla')`.
    public var isSupercharger: Bool {
        chargerType?.lowercased().contains("tesla") ?? false
    }

    /// Web `charger_type && !includes('tesla')` — non-Tesla DC fast charging.
    public var isDCFast: Bool {
        guard let type = chargerType, !type.isEmpty else { return false }
        return !type.lowercased().contains("tesla")
    }
}

// MARK: - Live charging telemetry (web `useChargingTelemetryLatest` subset)

/// The latest live charging telemetry (web `chargingLive`) feeding the Full-Charge-Complete
/// card and the thermal-monitoring panel. Module temperatures are SI Celsius; `updatedAt`
/// backs the ADR-013 staleness check (live values older than two minutes are stale).
public struct BatteryHealthLive: Hashable, Sendable {
    public let moduleTempMaxC: Double?
    public let moduleTempMinC: Double?
    public let numModuleTempMax: Int?
    public let numModuleTempMin: Int?
    public let batteryHeaterOn: Bool?
    public let bmsFullchargeComplete: Bool?
    public let updatedAt: Date?

    public init(
        moduleTempMaxC: Double?,
        moduleTempMinC: Double?,
        numModuleTempMax: Int?,
        numModuleTempMin: Int?,
        batteryHeaterOn: Bool?,
        bmsFullchargeComplete: Bool?,
        updatedAt: Date? = nil
    ) {
        self.moduleTempMaxC = moduleTempMaxC
        self.moduleTempMinC = moduleTempMinC
        self.numModuleTempMax = numModuleTempMax
        self.numModuleTempMin = numModuleTempMin
        self.batteryHeaterOn = batteryHeaterOn
        self.bmsFullchargeComplete = bmsFullchargeComplete
        self.updatedAt = updatedAt
    }

    /// ADR-013: a live value is fresh only within the last two minutes. Telemetry with
    /// no timestamp is treated as fresh (the wire shape did not carry one).
    public func isFresh(now: Date = Date()) -> Bool {
        guard let updatedAt else { return true }
        return now.timeIntervalSince(updatedAt) <= 120
    }

    /// Whether any thermal/full-charge field is present (gates the live indicator).
    public var hasData: Bool {
        moduleTempMaxC != nil || moduleTempMinC != nil || batteryHeaterOn != nil
            || bmsFullchargeComplete != nil
    }
}
