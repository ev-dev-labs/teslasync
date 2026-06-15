import Foundation

// Value types for the Lifetime Stats surface (web
// `web/src/features/analytics/pages/LifetimeStatsPage.tsx`, route `/lifetime-stats`). The page
// reads one source — `useLifetimeStats(vehicleId)` → `GET /analytics/lifetime?vehicle_id` — and
// renders an all-time roll-up: hero distance, four headline stat cards, fun facts, the EV-vs-gas
// savings bar, environmental impact, personal records, an activity summary, and the achievement
// gallery.
//
// Every measurement is SI canonical on disk — meters, meters-per-second, watt-hours, seconds —
// exactly as Phase-42 stores it; the user's unit preference is applied only at the SwiftUI render
// boundary via `Units` (ADR-005, SI-cutover instructions). The web wire delivers distance in km,
// speed in km/h, energy in kWh and durations in hours, so the data source scales each into its SI
// base when it builds the model (km×1000, kmh→m/s, kWh×1000, h×3600). Field names mirror the
// snake_case wire so the production KMP-backed source maps straight across, while the unit suffix
// records the SI base unit. The currency / count / ratio fields (savings, trees, earth
// circumferences, …) carry through verbatim — they are not unit-converted.

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct LifetimeStatsVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Personal record (web `PersonalRecord`: { value, date })

/// One all-time record (web `PersonalRecord`). `valueSI` is the record's measurement in its SI
/// base unit — meters for the longest drive, meters-per-second for the highest speed, watt-hours
/// for the biggest charge — and `date` is the ISO day the record was set (web `date: string |
/// null`), or `nil` when unknown.
public struct LifetimeRecord: Hashable, Sendable {
    public let valueSI: Double
    public let date: String?

    public init(valueSI: Double, date: String?) {
        self.valueSI = valueSI
        self.date = date
    }

    /// The absent record (web `longest_drive_record?.value ?? 0` with no date).
    public static let zero = LifetimeRecord(valueSI: 0, date: nil)
}

// MARK: - Achievement (web `LifetimeAchievement`)

/// One achievement badge (web `LifetimeAchievement`). `name` / `description` / `icon` are
/// server-provided display strings rendered verbatim (like a telemetry label), `unlocked` gates
/// the unlocked styling, and `progress` is a 0…1 completion fraction toward `target`.
public struct LifetimeAchievement: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let description: String
    public let icon: String
    public let unlocked: Bool
    public let unlockedAt: String?
    public let progress: Double
    public let target: Double
    public let current: Double

    public init(
        id: String,
        name: String,
        description: String,
        icon: String,
        unlocked: Bool,
        unlockedAt: String?,
        progress: Double,
        target: Double,
        current: Double
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.icon = icon
        self.unlocked = unlocked
        self.unlockedAt = unlockedAt
        self.progress = progress
        self.target = target
        self.current = current
    }

    /// Web `Math.round(progress * 100)` — completion percent for the badge ring / label.
    public var progressPercent: Int {
        Int((min(max(progress, 0), 1) * 100).rounded())
    }

    /// Web `!unlocked && progress >= 0.8` — the near-complete state the web pulses + tints amber.
    public var isNearComplete: Bool {
        !unlocked && progress >= 0.8
    }
}

// MARK: - Lifetime stats (web `LifetimeStats` → the page's single `useLifetimeStats` query)

/// The all-time roll-up for the selected vehicle (web `LifetimeStats`). SI on disk: distance in
/// meters (web wire `total_distance_km` × 1000), durations in seconds (web `*_hours` × 3600),
/// energy in watt-hours (web `total_energy_kwh` × 1000), record speed in m/s. Counts, ratios,
/// currency, CO₂ kg and day-equivalents carry through verbatim. Every value the page renders is
/// modeled here; the view converts to the user's unit at the boundary via `LifetimeStatsFormat`.
public struct LifetimeStats: Hashable, Sendable {
    // Driving
    public let totalDrives: Int
    public let totalDistanceM: Double
    public let totalDrivingSeconds: Double
    public let avgEfficiencyWhKm: Double

    // Charging
    public let totalChargeSessions: Int
    public let totalEnergyWh: Double
    public let totalChargingCost: Double

    // Savings
    public let gasEquivalentCost: Double
    public let totalSavings: Double
    public let co2OffsetKg: Double
    public let treesEquivalent: Int

    // Fun facts
    public let earthCircumferences: Double
    public let moonTrips: Double
    public let daysOnRoad: Double
    public let homesEquivalentDays: Double

    // Timeline
    public let firstDriveDate: String?
    public let ownershipDays: Int
    public let mostActiveDayOfWeek: String
    public let mostActiveHour: Int?

    // Personal records
    public let longestDriveRecord: LifetimeRecord
    public let highestSpeedRecord: LifetimeRecord
    public let maxChargeRecord: LifetimeRecord

    /// Achievements
    public let achievements: [LifetimeAchievement]

    public init(
        totalDrives: Int,
        totalDistanceM: Double,
        totalDrivingSeconds: Double,
        avgEfficiencyWhKm: Double,
        totalChargeSessions: Int,
        totalEnergyWh: Double,
        totalChargingCost: Double,
        gasEquivalentCost: Double,
        totalSavings: Double,
        co2OffsetKg: Double,
        treesEquivalent: Int,
        earthCircumferences: Double,
        moonTrips: Double,
        daysOnRoad: Double,
        homesEquivalentDays: Double,
        firstDriveDate: String?,
        ownershipDays: Int,
        mostActiveDayOfWeek: String,
        mostActiveHour: Int?,
        longestDriveRecord: LifetimeRecord,
        highestSpeedRecord: LifetimeRecord,
        maxChargeRecord: LifetimeRecord,
        achievements: [LifetimeAchievement]
    ) {
        self.totalDrives = totalDrives
        self.totalDistanceM = totalDistanceM
        self.totalDrivingSeconds = totalDrivingSeconds
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.totalChargeSessions = totalChargeSessions
        self.totalEnergyWh = totalEnergyWh
        self.totalChargingCost = totalChargingCost
        self.gasEquivalentCost = gasEquivalentCost
        self.totalSavings = totalSavings
        self.co2OffsetKg = co2OffsetKg
        self.treesEquivalent = treesEquivalent
        self.earthCircumferences = earthCircumferences
        self.moonTrips = moonTrips
        self.daysOnRoad = daysOnRoad
        self.homesEquivalentDays = homesEquivalentDays
        self.firstDriveDate = firstDriveDate
        self.ownershipDays = ownershipDays
        self.mostActiveDayOfWeek = mostActiveDayOfWeek
        self.mostActiveHour = mostActiveHour
        self.longestDriveRecord = longestDriveRecord
        self.highestSpeedRecord = highestSpeedRecord
        self.maxChargeRecord = maxChargeRecord
        self.achievements = achievements
    }

    /// Web `total_driving_hours` — driving time in whole hours (the seconds floor ÷ 3600), shown
    /// in the Total-Drives card sublabel as `${fmtNumber(total_driving_hours, 1)} hrs`.
    public var totalDrivingHours: Double {
        totalDrivingSeconds / 3600
    }

    /// Web `achievements.filter(a => a.unlocked).length` — the unlocked badge count.
    public var unlockedCount: Int {
        achievements.filter(\.unlocked).count
    }

    /// Web `stats && stats.earth_circumferences > 0` — gates the hero's Earth-comparison line.
    public var showsEarthComparison: Bool {
        earthCircumferences > 0
    }

    /// Web `stats && stats.ownership_days > 0` — gates the hero's "Tracking since …" line.
    public var showsSince: Bool {
        ownershipDays > 0
    }

    /// Web `stats && stats.gas_equivalent_cost > 0` — gates the savings bar vs. its empty state.
    public var hasSavingsData: Bool {
        gasEquivalentCost > 0
    }

    /// Web `Math.min((co2_offset_kg / 1000) * 100, 100)` expressed as a 0…1 ring fraction.
    public var co2RingFraction: Double {
        min(max(co2OffsetKg / 1000, 0), 1)
    }

    /// Web `Math.round(total_savings / 5)` — "cups of coffee saved" (≈ $5 each).
    public var coffeesSaved: Int {
        Int((totalSavings / 5).rounded())
    }

    /// Web `earth_circumferences * 100` — the Earth-progress fun-fact percentage.
    public var earthProgressPercent: Double {
        earthCircumferences * 100
    }

    /// Web `moon_trips * 100` — the Moon-progress fun-fact percentage.
    public var moonProgressPercent: Double {
        moonTrips * 100
    }
}

// MARK: - Savings bar derivation (web `SavingsBar`)

/// The two-bar EV-vs-gasoline cost comparison (web `SavingsBar`): each cost's width as a percent
/// of the larger cost, plus the headline savings + CO₂ avoided. Pure + unit-tested so the bar
/// widths match the web `Math.round((cost / maxCost) * 100)` exactly.
public struct LifetimeSavingsBar: Hashable, Sendable {
    public let evCost: Double
    public let gasCost: Double
    public let savings: Double
    public let co2Kg: Double

    public init(evCost: Double, gasCost: Double, savings: Double, co2Kg: Double) {
        self.evCost = evCost
        self.gasCost = gasCost
        self.savings = savings
        self.co2Kg = co2Kg
    }

    /// Web `Math.max(evCost, gasCost, 1)` — the denominator for both bar widths.
    public var maxCost: Double {
        max(evCost, gasCost, 1)
    }

    /// Web `Math.round((evCost / maxCost) * 100)` — electric-cost bar width as a 0…1 fraction.
    public var evFraction: Double {
        (evCost / maxCost).rounded(toPlaces: 2)
    }

    /// Web `Math.round((gasCost / maxCost) * 100)` — gas-cost bar width as a 0…1 fraction.
    public var gasFraction: Double {
        (gasCost / maxCost).rounded(toPlaces: 2)
    }
}

extension Double {
    /// Rounds to `places` decimal places — used so the savings-bar fractions match the web's
    /// whole-percent rounding (`Math.round(pct)`) once scaled back to a 0…1 width.
    func rounded(toPlaces places: Int) -> Double {
        guard isFinite else { return 0 }
        let divisor = pow(10.0, Double(places))
        return (self * divisor).rounded() / divisor
    }
}

// MARK: - Page phase (web `isLoading ? Skeleton : error ? errorRegion : body`)

/// The page's terminal phase. `.ready` is the web body — the hero + four stat cards always render
/// (with zero fallbacks), and each sub-panel resolves its own success/empty from the optional
/// stats (web `stats ? … : <EmptyState>`). `.error` is a retryable failure of the lifetime query
/// (web `PageContainer error`); `.loading` is the initial fetch (web `Skeleton`).
public enum LifetimeStatsPhase: Equatable, Sendable {
    case loading
    case error(String)
    case ready
}
