//
//  DataExportModels.swift
//  TeslaSync — P4 feature view · P7 · DataExportPage (Apple) — Domain models
//
//  Native peers of the web `web/src/features/system/pages/DataExportPage.tsx`
//  wire types. Field names mirror the snake_case JSON 1:1 through camelCase Swift
//  so the production KMP-backed binding (ADR-004) maps straight across. Byte
//  counts, record counts and timestamps are control-plane values (not
//  SI-unit-bearing), so — like the sibling `ExportsModels` — no SI conversion
//  applies; they are formatted only at the display boundary by `DataExportFormat`.
//

import SwiftUI

// MARK: - Export type (web `ExportType` + `EXPORT_TYPES`)

/// The data category an export job covers (web
/// `'drives' | 'charging' | 'trips' | 'analytics' | 'full_backup' | 'maintenance' | 'energy'`).
/// `localizedLabel` / `localizedDescription` resolve the web `labelKey` / `descKey`
/// verbatim so the catalog keys match the SPA.
enum DataExportType: String, CaseIterable, Identifiable, Sendable {
    case drives
    case charging
    case trips
    case analytics
    case fullBackup = "full_backup"
    case maintenance
    case energy

    var id: String { rawValue }

    /// SF Symbol standing in for the web lucide icon on each type card.
    var systemImage: String {
        switch self {
        case .drives: "car.fill"
        case .charging: "bolt.fill"
        case .trips: "map.fill"
        case .analytics: "chart.bar.fill"
        case .fullBackup: "externaldrive.fill"
        case .maintenance: "wrench.and.screwdriver.fill"
        case .energy: "battery.100.bolt"
        }
    }

    /// Accent tone for the active card border / icon (web `neon-${color}`).
    var tone: DataExportTone {
        switch self {
        case .drives, .trips: .cyan
        case .charging, .energy: .green
        case .analytics: .purple
        case .fullBackup: .amber
        case .maintenance: .red
        }
    }

    /// Whether the backend publishes a selectable column catalog for this type
    /// (web `catalogTypeFor`: only drives / charging). Drives the column picker.
    var supportsColumnSelection: Bool {
        self == .drives || self == .charging
    }

    var localizedLabel: String {
        switch self {
        case .drives: String(localized: "dataExport.types.drives", defaultValue: "Drives")
        case .charging: String(localized: "dataExport.types.charging", defaultValue: "Charging")
        case .trips: String(localized: "dataExport.types.trips", defaultValue: "Trips")
        case .analytics: String(localized: "dataExport.types.analytics", defaultValue: "Analytics")
        case .fullBackup: String(localized: "dataExport.types.fullBackup", defaultValue: "Full Backup")
        case .maintenance: String(localized: "dataExport.types.maintenance", defaultValue: "Maintenance")
        case .energy: String(localized: "dataExport.types.energy", defaultValue: "Energy")
        }
    }

    var localizedDescription: String {
        switch self {
        case .drives:
            String(localized: "dataExport.types.drivesDesc",
                   defaultValue: "Export drive sessions, routes, and efficiency data")
        case .charging:
            String(localized: "dataExport.types.chargingDesc",
                   defaultValue: "Export charging sessions and energy data")
        case .trips:
            String(localized: "dataExport.types.tripsDesc",
                   defaultValue: "Export trip summaries with SI aggregate columns")
        case .analytics:
            String(localized: "dataExport.types.analyticsDesc",
                   defaultValue: "Export analytics and aggregated statistics")
        case .fullBackup:
            String(localized: "dataExport.types.fullBackupDesc",
                   defaultValue: "Complete database backup of all vehicle data")
        case .maintenance:
            String(localized: "dataExport.types.maintenanceDesc",
                   defaultValue: "Export maintenance and service records")
        case .energy:
            String(localized: "dataExport.types.energyDesc",
                   defaultValue: "Export energy consumption and efficiency data")
        }
    }
}

// MARK: - Export format (web `ExportFormat` + `EXPORT_FORMATS`)

/// The serialization format for an export (web `'csv' | 'json'`).
enum DataExportFormat: String, CaseIterable, Identifiable, Sendable {
    case csv
    case json

    var id: String { rawValue }

    /// Upper-cased badge label (web `format.toUpperCase()`).
    var badge: String { rawValue.uppercased() }

    var systemImage: String {
        switch self {
        case .csv: "tablecells"
        case .json: "curlybraces"
        }
    }

    var localizedLabel: String {
        switch self {
        case .csv: String(localized: "dataExport.formats.csv", defaultValue: "CSV")
        case .json: String(localized: "dataExport.formats.json", defaultValue: "JSON")
        }
    }
}

// MARK: - Job status (web `ExportStatus` + `STATUS_CONFIG`)

/// Lifecycle status of an export job (web
/// `'queued' | 'processing' | 'ready' | 'failed' | 'expired'`). Tolerant: an
/// unexpected server token folds to `.unknown` but the raw token is preserved on
/// `DataExportJobSummary.rawStatus` so it still renders verbatim.
enum DataExportJobStatus: String, CaseIterable, Sendable {
    case queued
    case processing
    case ready
    case failed
    case expired
    case unknown

    init(wire: String) {
        self = DataExportJobStatus(rawValue: wire) ?? .unknown
    }

    /// Whether the spinner animates (web `spinning` on `processing`).
    var isSpinning: Bool { self == .processing }

    var systemImage: String {
        switch self {
        case .queued: "clock"
        case .processing: "arrow.triangle.2.circlepath"
        case .ready: "checkmark.circle.fill"
        case .failed: "xmark.octagon.fill"
        case .expired: "exclamationmark.circle"
        case .unknown: "questionmark.circle"
        }
    }

    /// Web `STATUS_CONFIG.badgeVariant`: ready → success, failed → danger,
    /// processing → info, queued → neutral, expired → warning.
    var tone: DataExportTone {
        switch self {
        case .ready: .green
        case .failed: .red
        case .processing: .cyan
        case .queued, .unknown: .neutral
        case .expired: .amber
        }
    }

    var localizedLabel: String {
        switch self {
        case .queued: String(localized: "dataExport.status.queued", defaultValue: "Queued")
        case .processing: String(localized: "dataExport.status.processing", defaultValue: "Processing")
        case .ready: String(localized: "dataExport.status.ready", defaultValue: "Ready")
        case .failed: String(localized: "dataExport.status.failed", defaultValue: "Failed")
        case .expired: String(localized: "dataExport.status.expired", defaultValue: "Expired")
        case .unknown: String(localized: "dataExport.status.unknown", defaultValue: "Unknown")
        }
    }
}

// MARK: - Accent tone (web `neon-${color}` palette, toned to HIG-safe colors)

/// A small accent-color vocabulary mapped to HIG-safe SwiftUI colors. Replaces
/// the web neon palette (the repo bans neon body text) with system colors that
/// adapt across light / dark / increased-contrast (ADR-015).
enum DataExportTone: Sendable {
    case cyan
    case green
    case purple
    case amber
    case red
    case blue
    case neutral

    var color: Color {
        switch self {
        case .cyan: .cyan
        case .green: .green
        case .purple: .purple
        case .amber: .orange
        case .red: .red
        case .blue: .blue
        case .neutral: .secondary
        }
    }
}

// MARK: - Wire value types

/// One export-job summary (web `ExportJobSummary`, `GET /export/jobs`).
struct DataExportJobSummary: Identifiable, Equatable, Sendable {
    let id: String
    let type: String
    let format: String
    let status: DataExportJobStatus
    /// Raw status token as received (rendered verbatim when no label key exists).
    let rawStatus: String
    let vehicleID: Int64?
    let recordCount: Int?
    let fileSize: Int64?
    let durationMs: Int?
    let errorMessage: String?
    let createdAt: String
    let completedAt: String?

    init(
        id: String,
        type: String,
        format: String,
        status: DataExportJobStatus,
        rawStatus: String? = nil,
        vehicleID: Int64? = nil,
        recordCount: Int? = nil,
        fileSize: Int64? = nil,
        durationMs: Int? = nil,
        errorMessage: String? = nil,
        createdAt: String,
        completedAt: String? = nil
    ) {
        self.id = id
        self.type = type
        self.format = format
        self.status = status
        self.rawStatus = rawStatus ?? status.rawValue
        self.vehicleID = vehicleID
        self.recordCount = recordCount
        self.fileSize = fileSize
        self.durationMs = durationMs
        self.errorMessage = errorMessage
        self.createdAt = createdAt
        self.completedAt = completedAt
    }

    /// Web `j.status === 'ready'` — only ready jobs expose a download affordance.
    var isDownloadable: Bool { status == .ready }

    /// Web `j.status === 'queued' || 'processing'` — counts toward "Active".
    var isActive: Bool { status == .queued || status == .processing }
}

/// A vehicle option for the wizard / account pickers (web `Vehicle`).
struct DataExportVehicle: Identifiable, Equatable, Sendable {
    let id: Int64
    let displayName: String?
    let vin: String?

    init(id: Int64, displayName: String? = nil, vin: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `v.display_name || v.vin || 'Vehicle {id}'`.
    var label: String {
        if let name = displayName, !name.isEmpty { return name }
        if let vin, !vin.isEmpty { return vin }
        return String(localized: "dataExport.vehicleFallback", defaultValue: "Vehicle \(id)")
    }
}

/// One selectable column (web `ExportColumnInfo`).
struct DataExportColumnInfo: Identifiable, Equatable, Sendable {
    var id: String { name }
    let name: String
    let label: String
    let alwaysIncluded: Bool
}

/// The column catalog for a type (web `ExportColumnsResponse`).
struct DataExportColumnsResponse: Equatable, Sendable {
    let type: String
    let columns: [DataExportColumnInfo]
    let supportsSelection: Bool
}

/// Aggregate record counts shown in the overview card (web `DataOverview`).
struct DataOverview: Equatable, Sendable {
    let drives: Int
    let chargingSessions: Int
}

// MARK: - Mutation payloads

/// Web `ExportSubmitPayload` (`POST /export/jobs`).
struct DataExportSubmitPayload: Equatable, Sendable {
    let type: DataExportType
    let format: DataExportFormat
    var vehicleID: Int64?
    var start: String?
    var end: String?
    var columns: [String]?
}

/// Web `CreateAccountExportPayload` (`POST /export/jobs/account`).
struct DataExportAccountPayload: Equatable, Sendable {
    var vehicleID: Int64?
    var start: String?
    var end: String?
}
