import Foundation

// Domain model for the Weekly Digest surface — the SwiftUI parity of
// `web/src/features/analytics/components/weekly-digest`. The web page derives a weekly summary from
// the legacy drives / charging / alerts shape (values already in display units: km, kWh, Wh, minutes,
// %), so these types carry those same display-unit values and the projection reproduces the web
// `useWeeklyDigest` arithmetic 1:1 (matching the sibling `SummaryHeroCards` / `DrivingSection`
// feature-view parity units). Foundation-only so the logic unit-tests without SwiftUI or the store.

// MARK: - Page phase (web `PageContainer` loading / error props + `hasData` gate)

/// The page's terminal phase, driven by the selected vehicle's weekly activity (web `useWeeklyDigest`).
/// `.ready` carries a week with activity (web `hasData` → digest renders); `.empty` is a successful
/// load whose selected week has no drives/charging (web `!hasData` → `EmptyState`); `.error` is a
/// retryable failure (web `PageContainer error`); `.loading` is the initial fetch (web `isLoading`).
public enum WeeklyDigestPhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Vehicle selection (web `useVehicles` → `vehicleOptions` / `Select`)

/// A vehicle the digest can be scoped to (web vehicle list). `name` is the display label
/// (web `display_name || vin`).
public struct DigestVehicle: Identifiable, Sendable, Equatable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

/// One option in the vehicle `Select` (web `vehicleOptions` entry: `{ value, label }`).
public struct DigestVehicleOption: Identifiable, Sendable, Equatable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - Raw activity (web `types.ts`: Drive / ChargingSession / Alert)

/// One drive in the loaded window (web `Drive`). Values are already in display units — distance in
/// km, duration in minutes, efficiency in Wh/km, energy used in kWh — exactly as the legacy
/// `/drives` payload the web page consumes.
public struct DigestDrive: Identifiable, Sendable, Equatable {
    public let id: Int
    public let startDate: Date
    public let distanceKm: Double
    public let durationMin: Double
    public let efficiencyWhKm: Double
    public let energyUsedKwh: Double

    public init(
        id: Int,
        startDate: Date,
        distanceKm: Double,
        durationMin: Double,
        efficiencyWhKm: Double,
        energyUsedKwh: Double
    ) {
        self.id = id
        self.startDate = startDate
        self.distanceKm = distanceKm
        self.durationMin = durationMin
        self.efficiencyWhKm = efficiencyWhKm
        self.energyUsedKwh = energyUsedKwh
    }
}

/// One charging session in the loaded window (web `ChargingSession`). Energy added in kWh, cost in the
/// user's currency, duration in minutes, battery percentages 0…100.
public struct DigestCharge: Identifiable, Sendable, Equatable {
    public let id: Int
    public let startTs: Date
    public let energyAddedKwh: Double
    public let cost: Double
    public let durationMin: Double
    public let startBatteryPct: Double
    public let endBatteryPct: Double

    public init(
        id: Int,
        startTs: Date,
        energyAddedKwh: Double,
        cost: Double,
        durationMin: Double,
        startBatteryPct: Double,
        endBatteryPct: Double
    ) {
        self.id = id
        self.startTs = startTs
        self.energyAddedKwh = energyAddedKwh
        self.cost = cost
        self.durationMin = durationMin
        self.startBatteryPct = startBatteryPct
        self.endBatteryPct = endBatteryPct
    }
}

/// One alert in the loaded window (web `Alert`): a severity (`info` / `warning` / `critical`) and a
/// timestamp used to bucket it into the selected week.
public struct DigestAlert: Identifiable, Sendable, Equatable {
    public let id: Int
    public let severity: String
    public let createdAt: Date

    public init(id: Int, severity: String, createdAt: Date) {
        self.id = id
        self.severity = severity
        self.createdAt = createdAt
    }
}

/// The full loaded activity for a vehicle (the web page loads all drives/charging/alerts once, then
/// re-filters client-side per selected week — there is no per-week refetch).
public struct DigestActivity: Sendable, Equatable {
    public var drives: [DigestDrive]
    public var charging: [DigestCharge]
    public var alerts: [DigestAlert]

    public init(drives: [DigestDrive], charging: [DigestCharge], alerts: [DigestAlert]) {
        self.drives = drives
        self.charging = charging
        self.alerts = alerts
    }

    /// No activity loaded (drives the defensive empty state).
    public static let empty = DigestActivity(drives: [], charging: [], alerts: [])
}

// MARK: - Aggregated metrics (web `DigestMetrics`)

/// One severity tally for the selected week (web `metrics.alertsByType` entry), preserving the
/// web first-seen iteration order so the severity rows + pie render identically.
public struct DigestAlertCount: Identifiable, Sendable, Equatable {
    public let severity: String
    public let count: Int

    public var id: String {
        severity
    }

    public init(severity: String, count: Int) {
        self.severity = severity
        self.count = count
    }
}

/// The aggregated weekly metrics the digest renders (web `DigestMetrics`). Each `prev…` is the prior
/// week's value the trend chips compare against. Distance/energy in km/kWh, cost in currency, duration
/// in minutes, battery in %, CO₂ in kg — all already in display units (web parity).
public struct DigestMetrics: Sendable, Equatable {
    public var totalDistance: Double
    public var prevDistance: Double
    public var totalDrives: Int
    public var prevDriveCount: Int
    public var energyUsed: Double
    public var prevEnergy: Double
    public var chargingCost: Double
    public var prevChargingCost: Double
    public var co2Saved: Double
    public var prevCo2: Double
    public var avgEfficiency: Double
    public var prevAvgEfficiency: Double
    public var totalDuration: Double
    public var topDrive: DigestDrive?
    public var chargeEnergyAdded: Double
    public var prevChargeEnergy: Double
    public var avgChargeRate: Double
    public var chargingSessionCount: Int
    public var batteryStart: Double
    public var batteryEnd: Double
    public var alertCounts: [DigestAlertCount]
    public var alertTotal: Int

    public init(
        totalDistance: Double = 0,
        prevDistance: Double = 0,
        totalDrives: Int = 0,
        prevDriveCount: Int = 0,
        energyUsed: Double = 0,
        prevEnergy: Double = 0,
        chargingCost: Double = 0,
        prevChargingCost: Double = 0,
        co2Saved: Double = 0,
        prevCo2: Double = 0,
        avgEfficiency: Double = 0,
        prevAvgEfficiency: Double = 0,
        totalDuration: Double = 0,
        topDrive: DigestDrive? = nil,
        chargeEnergyAdded: Double = 0,
        prevChargeEnergy: Double = 0,
        avgChargeRate: Double = 0,
        chargingSessionCount: Int = 0,
        batteryStart: Double = 0,
        batteryEnd: Double = 0,
        alertCounts: [DigestAlertCount] = [],
        alertTotal: Int = 0
    ) {
        self.totalDistance = totalDistance
        self.prevDistance = prevDistance
        self.totalDrives = totalDrives
        self.prevDriveCount = prevDriveCount
        self.energyUsed = energyUsed
        self.prevEnergy = prevEnergy
        self.chargingCost = chargingCost
        self.prevChargingCost = prevChargingCost
        self.co2Saved = co2Saved
        self.prevCo2 = prevCo2
        self.avgEfficiency = avgEfficiency
        self.prevAvgEfficiency = prevAvgEfficiency
        self.totalDuration = totalDuration
        self.topDrive = topDrive
        self.chargeEnergyAdded = chargeEnergyAdded
        self.prevChargeEnergy = prevChargeEnergy
        self.avgChargeRate = avgChargeRate
        self.chargingSessionCount = chargingSessionCount
        self.batteryStart = batteryStart
        self.batteryEnd = batteryEnd
        self.alertCounts = alertCounts
        self.alertTotal = alertTotal
    }
}

// MARK: - Derived chart series (web `dailyDistanceData` / `dailyEnergyData` / `alertPieData`)

/// One day-of-week bar for the daily distance / energy charts (web `DailyDistanceEntry` /
/// `DailyEnergyEntry`): a Mon…Sun label and the summed value for that day.
public struct DigestDailyBar: Identifiable, Sendable, Equatable {
    public let day: String
    public let value: Double

    public var id: String {
        day
    }

    public init(day: String, value: Double) {
        self.day = day
        self.value = value
    }
}

/// One alert-distribution slice (web `AlertPieEntry`): the capitalized severity name, its count, the
/// raw severity (for the row icons), and a stable palette index for the donut.
public struct DigestAlertSlice: Identifiable, Sendable, Equatable {
    public let name: String
    public let value: Int
    public let severity: String
    public let colorIndex: Int

    public var id: String {
        severity
    }

    public init(name: String, value: Int, severity: String, colorIndex: Int) {
        self.name = name
        self.value = value
        self.severity = severity
        self.colorIndex = colorIndex
    }
}

/// The "you drove ≈ N× CityA → CityB" novelty payload (web `FunFact`). `times` is already
/// display-formatted by the projection (web `fmtNumber(times, 1)`).
public struct DigestFunFact: Sendable, Equatable {
    public let from: String
    public let to: String
    public let times: String

    public init(from: String, to: String, times: String) {
        self.from = from
        self.to = to
        self.times = times
    }
}

/// Everything the page derives for the selected week in one pass (web `useWeeklyDigest` memoized
/// outputs), so SwiftUI reads pre-computed values rather than re-filtering on every render.
public struct DigestComputed: Sendable, Equatable {
    public let metrics: DigestMetrics
    public let dailyDistance: [DigestDailyBar]
    public let dailyEnergy: [DigestDailyBar]
    public let alertSlices: [DigestAlertSlice]
    public let funFact: DigestFunFact?
    public let hasData: Bool

    public init(
        metrics: DigestMetrics,
        dailyDistance: [DigestDailyBar],
        dailyEnergy: [DigestDailyBar],
        alertSlices: [DigestAlertSlice],
        funFact: DigestFunFact?,
        hasData: Bool
    ) {
        self.metrics = metrics
        self.dailyDistance = dailyDistance
        self.dailyEnergy = dailyEnergy
        self.alertSlices = alertSlices
        self.funFact = funFact
        self.hasData = hasData
    }

    /// The zeroed digest (no vehicle / no activity) — drives the empty state.
    public static let empty = DigestComputed(
        metrics: DigestMetrics(),
        dailyDistance: WeeklyDigestCalendar.emptyDailyBars,
        dailyEnergy: WeeklyDigestCalendar.emptyDailyBars,
        alertSlices: [],
        funFact: nil,
        hasData: false
    )
}

// MARK: - Trend (web `helpers.trendFor`)

/// The arrow a trend chip points (web `'up' | 'down' | 'flat'`).
public enum DigestTrendDirection: Sendable, Equatable {
    case up
    case down
    case flat
}

/// A computed week-over-week trend chip (web `trendFor` return value). `positive` already folds in
/// `invertPositive`, so it — not `direction` — drives the chip's good/bad color, exactly as the web
/// `change.positive` does.
public struct DigestTrend: Sendable, Equatable {
    public let direction: DigestTrendDirection
    public let value: String
    public let positive: Bool

    public init(direction: DigestTrendDirection, value: String, positive: Bool) {
        self.direction = direction
        self.value = value
        self.positive = positive
    }
}

/// Pure week-over-week trend math, reproducing `helpers.ts` `pctChange` + `trendFor`.
public enum DigestTrendCalculator {
    /// Web `pctChange`: `previous == 0 → (current > 0 ? 100 : 0)`, else the signed percentage change
    /// over `abs(previous)`.
    public static func pctChange(current: Double, previous: Double) -> Double {
        if previous == 0 { return current > 0 ? 100 : 0 }
        return ((current - previous) / abs(previous)) * 100
    }

    /// Web `trendFor(current, previous, invertPositive)`: a `< 0.01` absolute delta is a flat `0%`;
    /// otherwise an up/down chip whose `value` is the signed percent (`+` prefix when rising) and
    /// whose `positive` is inverted for "lower is better" metrics (energy, cost, efficiency).
    public static func trend(
        current: Double,
        previous: Double,
        invertPositive: Bool = false
    ) -> DigestTrend {
        let diff = current - previous
        if abs(diff) < 0.01 {
            return DigestTrend(direction: .flat, value: "0%", positive: true)
        }
        let isUp = diff > 0
        let pct = pctChange(current: current, previous: previous)
        let sign = isUp ? "+" : ""
        return DigestTrend(
            direction: isUp ? .up : .down,
            value: "\(sign)\(WeeklyDigestFormat.number(pct, decimals: 1))%",
            positive: invertPositive ? !isUp : isUp
        )
    }
}

// MARK: - Data source seam (web `useVehicles` + drives/charging/alerts queries)

/// The seam the page model binds through (ADR-004 — no networking in the view). The production app
/// implements this over the shared KMP repositories (the web `/vehicles`, `/drives?vehicle_id=`,
/// `/charging?vehicle_id=`, `/alerts` queries); previews/tests inject `SampleWeeklyDigestDataSource`
/// and the empty/failing doubles.
public protocol WeeklyDigestDataSource: Sendable {
    /// Loads the vehicle list the digest can be scoped to (web `useVehicles`).
    func loadVehicles() async throws -> [DigestVehicle]
    /// Loads all drives/charging/alerts for a vehicle, re-filtered client-side per week.
    func loadActivity(vehicleID: String) async throws -> DigestActivity
}
