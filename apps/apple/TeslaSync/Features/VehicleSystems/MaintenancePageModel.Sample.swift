import Foundation

/// A representative local seed used as the `MaintenancePage` / preview default until the KMP-backed
/// source is injected at composition time (mirroring the sibling pages' sample sources). It is NOT
/// production data — it is an API-response-shaped fixture (3 vehicles + a mixed-status maintenance
/// schedule + a service history) so the surface renders its populated success state, with every status
/// (good / soon / overdue / completed), interval kind (miles / months), and a multi-year cost history
/// represented. The web `/maintenance` endpoint is not vehicle-filtered, so the schedule is shared.
public struct SampleMaintenanceDataSource: MaintenanceDataSource {
    public init() {}

    public func loadVehicles() async throws -> [MaintenanceVehicle] {
        [
            MaintenanceVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001"),
            MaintenanceVehicle(id: 2, displayName: "Tachi", vin: "5YJYGDEE1LF000002"),
            MaintenanceVehicle(id: 3, displayName: "Razorback", vin: "5YJSA1E26MF000003")
        ]
    }

    public func loadItems(vehicleID: Int64) async throws -> [MaintenanceItem] {
        [
            MaintenanceItem(
                id: 1, vehicleID: vehicleID, category: "tires", name: "Tire Rotation",
                details: "Rotate tires to even out tread wear and extend tire life.",
                dueMileage: 25000, currentMileage: 24500, lastServiceDate: Self.date(2025, 9, 12),
                lastServiceMileage: 18000, intervalMiles: 7500, status: .soon
            ),
            MaintenanceItem(
                id: 2, vehicleID: vehicleID, category: "brakes", name: "Brake Inspection",
                details: "Inspect pads, rotors, and calipers; flush brake fluid if due.",
                dueMileage: 24000, currentMileage: 24500, lastServiceDate: Self.date(2023, 11, 20),
                lastServiceMileage: 12000, intervalMiles: 12000, status: .overdue
            ),
            MaintenanceItem(
                id: 3, vehicleID: vehicleID, category: "filters", name: "Cabin Air Filter",
                details: "Replace the cabin HEPA filter for clean cabin airflow.",
                dueMileage: 30000, currentMileage: 24500, lastServiceDate: Self.date(2025, 6, 3),
                lastServiceMileage: 16000, intervalMiles: 12500, status: .good
            ),
            MaintenanceItem(
                id: 4, vehicleID: vehicleID, category: "fluids", name: "Coolant Service",
                details: "Inspect and replace battery coolant per the long-interval schedule.",
                dueDate: Self.date(2028, 1, 10), currentMileage: 24500,
                lastServiceDate: Self.date(2024, 1, 10), intervalMonths: 48, status: .good
            ),
            MaintenanceItem(
                id: 5, vehicleID: vehicleID, category: "general", name: "Brake Fluid Test",
                details: "Test brake fluid for moisture content every two years.",
                currentMileage: 24500, lastServiceDate: Self.date(2024, 8, 15),
                intervalMonths: 24, status: .soon
            ),
            MaintenanceItem(
                id: 6, vehicleID: vehicleID, category: "wipers", name: "Wiper Blades",
                details: "Replace front wiper blades.",
                currentMileage: 24500, lastServiceDate: Self.date(2026, 2, 1), status: .completed
            )
        ]
    }

    public func loadRecords(vehicleID: Int64) async throws -> [ServiceRecord] {
        [
            ServiceRecord(
                id: 1, vehicleID: vehicleID, date: Self.date(2025, 9, 12),
                details: "Tire rotation + alignment", mileage: 18000, cost: 120,
                provider: "Tesla Service Center"
            ),
            ServiceRecord(
                id: 2, vehicleID: vehicleID, date: Self.date(2025, 6, 3),
                details: "Cabin & HEPA filter replacement", mileage: 16000, cost: 95,
                provider: "Tesla Mobile Service"
            ),
            ServiceRecord(
                id: 3, vehicleID: vehicleID, date: Self.date(2024, 11, 20),
                details: "Brake fluid flush", mileage: 12000, cost: 180, provider: "Tesla Service Center"
            ),
            ServiceRecord(
                id: 4, vehicleID: vehicleID, date: Self.date(2024, 8, 15),
                details: "Annual inspection", mileage: 9000, cost: 0, provider: "Tesla Service Center"
            ),
            ServiceRecord(
                id: 5, vehicleID: vehicleID, date: Self.date(2024, 1, 10),
                details: "Coolant top-up", mileage: 4000, cost: 60, provider: "Independent Shop"
            )
        ]
    }

    /// Builds a stable gregorian calendar date (deterministic fixtures, never `Date()`).
    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 9
        return Calendar(identifier: .gregorian).date(from: components) ?? Date(timeIntervalSince1970: 0)
    }
}

#if DEBUG
    /// Preview/test seam yielding a single vehicle with no items and no records — drives the page's
    /// no-data empty state (web "No maintenance items").
    public struct EmptyMaintenanceDataSource: MaintenanceDataSource {
        public init() {}

        public func loadVehicles() async throws -> [MaintenanceVehicle] {
            [MaintenanceVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadItems(vehicleID _: Int64) async throws -> [MaintenanceItem] {
            []
        }

        public func loadRecords(vehicleID _: Int64) async throws -> [ServiceRecord] {
            []
        }
    }

    /// Preview/test seam whose primary items load fails — drives the error state (web error + Retry).
    public struct FailingMaintenanceDataSource: MaintenanceDataSource {
        public struct Failure: Error {}
        public init() {}

        public func loadVehicles() async throws -> [MaintenanceVehicle] {
            [MaintenanceVehicle(id: 1, displayName: "Rocinante", vin: "5YJ3E1EA7KF000001")]
        }

        public func loadItems(vehicleID _: Int64) async throws -> [MaintenanceItem] {
            throw Failure()
        }

        public func loadRecords(vehicleID _: Int64) async throws -> [ServiceRecord] {
            []
        }
    }

    /// Preview/test seam whose service-records (secondary) load fails while items succeed — drives the
    /// web `anyError` banner over still-rendered content.
    public struct SecondaryFailingMaintenanceDataSource: MaintenanceDataSource {
        public struct Failure: Error {}
        private let base = SampleMaintenanceDataSource()
        public init() {}

        public func loadVehicles() async throws -> [MaintenanceVehicle] {
            try await base.loadVehicles()
        }

        public func loadItems(vehicleID: Int64) async throws -> [MaintenanceItem] {
            try await base.loadItems(vehicleID: vehicleID)
        }

        public func loadRecords(vehicleID _: Int64) async throws -> [ServiceRecord] {
            throw Failure()
        }
    }
#endif
