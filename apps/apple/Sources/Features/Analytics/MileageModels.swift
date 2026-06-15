import Foundation

// Value types for the Mileage surface (web `MileagePage.tsx`, route `/mileage`).
// Every measurement is SI canonical — meters — exactly as Phase-42 stores it; the user's distance
// unit preference is applied only at the SwiftUI render boundary via `Units` (ADR-005, SI-cutover
// instructions). The backend `/mileage/{stats,daily,monthly}` endpoints return kilometres, so the
// production KMP-backed data source multiplies by 1000 when mapping the wire into these SI meters
// (web does the same: `fromKm(km) = convertDistanceFromSI(km * 1000, unit)`).

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct MileagePageVehicle: Identifiable, Hashable, Sendable {
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

// MARK: - Stats (web `useMileageStats` → `GET /mileage/stats?vehicle_id`)

/// Lifetime + windowed mileage roll-up for one vehicle (web `MileageStats`). The primary source —
/// its presence drives the page's loading / empty / error / success phases. Distances are SI meters
/// (web wire is km × 1000). `lifetimeDistanceM` ← `lifetime_km`, `last30dDistanceM` ← `last_30d_km`,
/// `driveCountLifetime` ← `drive_count_lifetime`.
public struct MileageStats: Hashable, Sendable {
    public let lifetimeDistanceM: Double
    public let last30dDistanceM: Double
    public let driveCountLifetime: Int

    public init(lifetimeDistanceM: Double, last30dDistanceM: Double, driveCountLifetime: Int) {
        self.lifetimeDistanceM = lifetimeDistanceM
        self.last30dDistanceM = last30dDistanceM
        self.driveCountLifetime = driveCountLifetime
    }

    /// Web `(stats.last_30d_km ?? 0) / 30` — mean daily distance over the trailing 30 days (SI m).
    /// Reflects recent activity rather than a lifetime-flat average.
    public var dailyAverageM: Double {
        last30dDistanceM / 30
    }

    /// Web `dailyAvgKm * 365` — the 30-day rate annualized (SI meters).
    public var annualProjectionM: Double {
        dailyAverageM * 365
    }
}

// MARK: - Daily bucket (web `useDailyMileage` → `GET /mileage/daily?vehicle_id&days`)

/// One day's mileage bucket (web daily row). `totalDistanceM` ← `total_km × 1000`; `endOdometerM`
/// ← `end_odometer_km × 1000` and is nil on days where every drive ended with a NULL odometer
/// reading (web filters those out of the odometer line so it doesn't dive to zero).
public struct MileageDailyPoint: Identifiable, Hashable, Sendable {
    public let date: Date
    public let totalDistanceM: Double
    public let endOdometerM: Double?

    public var id: Date {
        date
    }

    public init(date: Date, totalDistanceM: Double, endOdometerM: Double?) {
        self.date = date
        self.totalDistanceM = totalDistanceM
        self.endOdometerM = endOdometerM
    }
}

// MARK: - Monthly bucket (web `useMonthlyMileage` → `GET /mileage/monthly?vehicle_id`)

/// One UTC calendar month's mileage roll-up (web monthly row). `yearMonth` ← `year_month`,
/// `totalDistanceM` ← `total_km × 1000`, `driveCount` ← `drive_count`.
public struct MileageMonthPoint: Identifiable, Hashable, Sendable {
    public let yearMonth: String
    public let totalDistanceM: Double
    public let driveCount: Int

    public var id: String {
        yearMonth
    }

    public init(yearMonth: String, totalDistanceM: Double, driveCount: Int) {
        self.yearMonth = yearMonth
        self.totalDistanceM = totalDistanceM
        self.driveCount = driveCount
    }

    /// Web `drives > 0 ? fromKm(km / drives) : 0` — mean distance per drive for the month (SI m).
    public var distancePerDriveM: Double {
        driveCount > 0 ? totalDistanceM / Double(driveCount) : 0
    }
}
