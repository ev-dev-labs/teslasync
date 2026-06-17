import Foundation
import SwiftUI

// Domain models + data-source seam for the Maintenance surface — the SwiftUI parity of
// `web/src/features/vehicle-systems/pages/MaintenancePage.tsx`. Mirrors the web `MaintenanceItem`
// and `ServiceRecord` shapes (snake_case JSON → Swift camelCase) plus the page's derived summary /
// cost / projection view-data. Pure value types (no SwiftUI, no networking) so the model + formatters
// stay testable; the view binds the `@Observable` model that reads everything through
// `MaintenanceDataSource` (ADR-004 — the view holds no networking).

// MARK: - Status (web `MaintenanceStatus` union + STATUS_BADGE_MAP / STATUS_SORT_ORDER)

/// One maintenance item's status (web `'good' | 'soon' | 'overdue' | 'completed'`). Carries the web
/// badge tone + label key and the web sort weight so the view never re-derives them.
public enum MaintenanceStatus: String, CaseIterable, Sendable {
    case good
    case soon
    case overdue
    case completed

    /// Web `STATUS_SORT_ORDER` (overdue first, completed last).
    public var sortOrder: Int {
        switch self {
        case .overdue: 0
        case .soon: 1
        case .good: 2
        case .completed: 3
        }
    }

    /// Web `STATUS_BADGE_MAP[...].variant` mapped to the shared semantic tone.
    public var tone: TSTone {
        switch self {
        case .good: .success
        case .soon: .warning
        case .overdue: .danger
        case .completed: .info
        }
    }

    /// Web `STATUS_BADGE_MAP[...].label` (a localized catalog key).
    public var labelKey: LocalizedStringKey {
        switch self {
        case .good: "Good"
        case .soon: "Due Soon"
        case .overdue: "Overdue"
        case .completed: "Completed"
        }
    }
}

// MARK: - Maintenance item (web `MaintenanceItem`)

/// A scheduled maintenance item (web `MaintenanceItem`). Odometer values are kept in the maintenance
/// domain's miles (the web renders them verbatim with a hardcoded `mi` label — they are service-log
/// odometer readings, not telemetry SI distances). Nullable web fields map to Swift optionals.
public struct MaintenanceItem: Identifiable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let category: String
    public let name: String
    public let details: String
    public let dueDate: Date?
    public let dueMileage: Double?
    public let currentMileage: Double
    public let lastServiceDate: Date?
    public let lastServiceMileage: Double?
    public let intervalMonths: Int?
    public let intervalMiles: Double?
    public let status: MaintenanceStatus

    public init(
        id: Int64,
        vehicleID: Int64,
        category: String,
        name: String,
        details: String,
        dueDate: Date? = nil,
        dueMileage: Double? = nil,
        currentMileage: Double = 0,
        lastServiceDate: Date? = nil,
        lastServiceMileage: Double? = nil,
        intervalMonths: Int? = nil,
        intervalMiles: Double? = nil,
        status: MaintenanceStatus
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.category = category
        self.name = name
        self.details = details
        self.dueDate = dueDate
        self.dueMileage = dueMileage
        self.currentMileage = currentMileage
        self.lastServiceDate = lastServiceDate
        self.lastServiceMileage = lastServiceMileage
        self.intervalMonths = intervalMonths
        self.intervalMiles = intervalMiles
        self.status = status
    }
}

// MARK: - Service record (web `ServiceRecord`)

/// A logged service record (web `ServiceRecord`) — one row of the Service Records table.
public struct ServiceRecord: Identifiable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let date: Date
    public let details: String
    public let mileage: Double
    public let cost: Double
    public let provider: String
    public let notes: String

    public init(
        id: Int64,
        vehicleID: Int64,
        date: Date,
        details: String,
        mileage: Double,
        cost: Double,
        provider: String,
        notes: String = ""
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.date = date
        self.details = details
        self.mileage = mileage
        self.cost = cost
        self.provider = provider
        self.notes = notes
    }
}

// MARK: - Vehicle (web `useSelectedVehicle` option)

/// A selectable vehicle for the header picker (web global `VehicleSelect`).
public struct MaintenanceVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vin` fallback.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Derived view-data (web `summary` / `costStats` / `projections`)

/// Web summary reduce over items (Total / Due-Soon / Overdue / Completed counts).
public struct MaintenanceSummary: Equatable, Sendable {
    public var total = 0
    public var soon = 0
    public var overdue = 0
    public var completed = 0

    public init(total: Int = 0, soon: Int = 0, overdue: Int = 0, completed: Int = 0) {
        self.total = total
        self.soon = soon
        self.overdue = overdue
        self.completed = completed
    }
}

/// Web `costStats` derived from the service records (total / annualized / per-service average).
public struct MaintenanceCostStats: Equatable, Sendable {
    public let totalCost: Double
    public let annualCost: Double
    public let avgPerService: Double

    public init(totalCost: Double, annualCost: Double, avgPerService: Double) {
        self.totalCost = totalCost
        self.annualCost = annualCost
        self.avgPerService = avgPerService
    }
}

/// Web `projections` row — an upcoming service with miles-remaining + due date (top 8).
public struct MaintenanceServiceProjection: Identifiable, Sendable {
    public let id: Int64
    public let name: String
    public let category: String
    public let milesRemaining: Double?
    public let dueDate: Date?
    public let status: MaintenanceStatus

    public init(
        id: Int64,
        name: String,
        category: String,
        milesRemaining: Double?,
        dueDate: Date?,
        status: MaintenanceStatus
    ) {
        self.id = id
        self.name = name
        self.category = category
        self.milesRemaining = milesRemaining
        self.dueDate = dueDate
        self.status = status
    }
}

// MARK: - Sort key (web `SORT_OPTIONS`)

/// The item sort key (web `SORT_OPTIONS`). Titles resolve from the catalog with the web labels.
public enum MaintenanceSortKey: String, CaseIterable, Identifiable, Sendable {
    case status
    case name
    case dueDate
    case category

    public var id: String {
        rawValue
    }

    public var titleKey: LocalizedStringKey {
        switch self {
        case .status: "Status"
        case .name: "Name"
        case .dueDate: "Due Date"
        case .category: "Category"
        }
    }
}

// MARK: - Data source seam (web hooks: useSelectedVehicle / request('/maintenance' & '/records'))

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject doubles
/// to drive the loading / empty / error / success states. Method ↔ web map: `loadVehicles` ←
/// `useSelectedVehicle`/`GET /vehicles`; `loadItems` ← `request('/maintenance')`; `loadRecords` ←
/// `request('/maintenance/records')`.
public protocol MaintenanceDataSource: Sendable {
    func loadVehicles() async throws -> [MaintenanceVehicle]
    func loadItems(vehicleID: Int64) async throws -> [MaintenanceItem]
    func loadRecords(vehicleID: Int64) async throws -> [ServiceRecord]
}
