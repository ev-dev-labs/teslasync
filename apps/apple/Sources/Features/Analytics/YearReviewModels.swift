import SwiftUI

// Value types for the Year-in-Review story surface (web `YearReviewPage.tsx`, route
// `/year-review/:year`). Every measurement is SI canonical — meters, watt-hours, seconds, Wh/km —
// exactly as Phase-42 stores it; the user's unit preference is applied only at the SwiftUI render
// boundary via `Units` (ADR-005, SI-cutover instructions). Field names mirror the snake_case wire
// (`total_distance_km`, `co2_offset_kg`, …) so the production KMP-backed data source maps straight
// across, while the unit suffix records the SI base unit on disk (km × 1000 → meters, etc.).

// MARK: - Vehicle (web `useVehicles` → `GET /vehicles`, and `data.vehicle`)

/// One selectable vehicle plus its model name (web `vehicle.display_name` / `vehicle.model`).
/// Identity + label strings, not SI measurements, so they round-trip verbatim.
public struct YearReviewStoryVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let model: String

    public init(id: Int64, displayName: String, model: String) {
        self.id = id
        self.displayName = displayName
        self.model = model
    }

    /// The label shown in the selector (web falls back to the VIN; here the display name).
    public var name: String {
        displayName.isEmpty ? model : displayName
    }
}

// MARK: - Drive highlight (web `YearReviewDriveHighlight`)

/// A single highlighted drive (web `longest_drive` / `most_efficient_drive`). Distance is SI
/// meters (web wire is km × 1000), duration is SI seconds (web wire is minutes × 60), efficiency
/// is SI Wh/km. Addresses + date are label strings rendered verbatim.
public struct YearReviewDriveHighlight: Hashable, Sendable {
    public let driveID: Int64
    public let date: String
    public let distanceM: Double
    public let durationS: Double
    public let startAddress: String
    public let endAddress: String
    public let efficiencyWhKm: Double

    public init(
        driveID: Int64,
        date: String,
        distanceM: Double,
        durationS: Double,
        startAddress: String,
        endAddress: String,
        efficiencyWhKm: Double
    ) {
        self.driveID = driveID
        self.date = date
        self.distanceM = distanceM
        self.durationS = durationS
        self.startAddress = startAddress
        self.endAddress = endAddress
        self.efficiencyWhKm = efficiencyWhKm
    }
}

// MARK: - Monthly + comparison records

/// One month's drive count for the activity chart (web `monthly_stats[].drives`).
public struct YearReviewMonthStat: Identifiable, Hashable, Sendable {
    /// The 1…12 month number (web `m.month`).
    public let month: Int
    public let drives: Int

    public var id: Int {
        month
    }

    public init(month: Int, drives: Int) {
        self.month = month
        self.drives = drives
    }
}

/// One "fun fact" card (web `YearReviewComparison`: emoji + label + value).
public struct YearReviewComparison: Identifiable, Hashable, Sendable {
    public let label: String
    public let value: String
    public let emoji: String

    public var id: String {
        label
    }

    public init(label: String, value: String, emoji: String) {
        self.label = label
        self.value = value
        self.emoji = emoji
    }
}

// MARK: - Year review (web `useYearReview` → `GET /analytics/year-review [year, vehicle_id]`)

/// The full annual roll-up the story renders (web `YearReview`). The single review source — its
/// presence drives the page's loading / empty / error / success phases. SI canonical throughout.
public struct YearReview: Hashable, Sendable {
    public let year: Int
    public let vehicle: YearReviewStoryVehicle

    public let totalDrives: Int
    public let totalDistanceM: Double
    public let totalEnergyWh: Double
    public let totalChargeSessions: Int
    public let totalChargingCost: Double
    public let gasSavings: Double
    public let co2OffsetKg: Double

    public let longestDrive: YearReviewDriveHighlight?
    public let mostEfficientDrive: YearReviewDriveHighlight?

    public let monthlyStats: [YearReviewMonthStat]

    public let mostActiveDayOfWeek: String
    public let mostActiveHour: Int
    public let avgDrivesPerWeek: Double
    public let avgDistancePerDriveM: Double
    public let avgEfficiencyWhKm: Double

    public let superchargerPct: Double
    public let dcFastPct: Double
    public let acOtherPct: Double
    public let avgChargeStartSoc: Double

    public let comparisons: [YearReviewComparison]

    public init(
        year: Int,
        vehicle: YearReviewStoryVehicle,
        totalDrives: Int,
        totalDistanceM: Double,
        totalEnergyWh: Double,
        totalChargeSessions: Int,
        totalChargingCost: Double,
        gasSavings: Double,
        co2OffsetKg: Double,
        longestDrive: YearReviewDriveHighlight?,
        mostEfficientDrive: YearReviewDriveHighlight?,
        monthlyStats: [YearReviewMonthStat],
        mostActiveDayOfWeek: String,
        mostActiveHour: Int,
        avgDrivesPerWeek: Double,
        avgDistancePerDriveM: Double,
        avgEfficiencyWhKm: Double,
        superchargerPct: Double,
        dcFastPct: Double,
        acOtherPct: Double,
        avgChargeStartSoc: Double,
        comparisons: [YearReviewComparison]
    ) {
        self.year = year
        self.vehicle = vehicle
        self.totalDrives = totalDrives
        self.totalDistanceM = totalDistanceM
        self.totalEnergyWh = totalEnergyWh
        self.totalChargeSessions = totalChargeSessions
        self.totalChargingCost = totalChargingCost
        self.gasSavings = gasSavings
        self.co2OffsetKg = co2OffsetKg
        self.longestDrive = longestDrive
        self.mostEfficientDrive = mostEfficientDrive
        self.monthlyStats = monthlyStats
        self.mostActiveDayOfWeek = mostActiveDayOfWeek
        self.mostActiveHour = mostActiveHour
        self.avgDrivesPerWeek = avgDrivesPerWeek
        self.avgDistancePerDriveM = avgDistancePerDriveM
        self.avgEfficiencyWhKm = avgEfficiencyWhKm
        self.superchargerPct = superchargerPct
        self.dcFastPct = dcFastPct
        self.acOtherPct = acOtherPct
        self.avgChargeStartSoc = avgChargeStartSoc
        self.comparisons = comparisons
    }

    /// Web no-data guard: `total_drives === 0 && total_charge_sessions === 0` → the empty state.
    public var hasNoData: Bool {
        totalDrives == 0 && totalChargeSessions == 0
    }

    /// Total distance expressed in SI kilometers (web `total_distance_km`), used for the
    /// "% around the Earth" comparison which is unit-preference-independent.
    public var totalDistanceKm: Double {
        totalDistanceM / 1000
    }

    /// Total energy expressed in kWh (web `total_energy_kwh`), shown directly without a unit pref.
    public var totalEnergyKWh: Double {
        totalEnergyWh / 1000
    }
}
