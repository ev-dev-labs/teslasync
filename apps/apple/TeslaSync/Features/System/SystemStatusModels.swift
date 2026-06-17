import Foundation

// MARK: - Data Models

struct SystemHealthData: Codable {
    let status: String
    let database: DatabaseHealth
    let telemetry: TelemetryHealth
    let workers: WorkersHealth
    let teslaAPIUsage: TeslaAPIUsage?
    let recentErrors: [ErrorLog]
    let version: String
    let uptime: Int
    let updateAvailable: String?
    let services: [ServiceHealth]
}

struct ExtendedHealth: Codable {
    let storage: StorageHealth
    let backup: BackupHealth
    let maintenance: MaintenanceState?
}

struct DatabaseHealth: Codable {
    let status: String
    let latencyMs: Double
    let poolAcquired: Int
    let poolIdle: Int
    let totalRows: Int
    let tableCount: Int
    let sizeBytes: Int64
}

struct TelemetryHealth: Codable {
    let status: String
    let messagesProcessed: Int
    let lastMessageTime: String?
}

struct WorkersHealth: Codable {
    let overallStatus: String
    let totalCount: Int
    let unhealthyCount: Int
}

struct TeslaAPIUsage: Codable {
    let estimatedCost: Double
    let monthlyCredit: Double
    let periodStart: String
}

struct ErrorLog: Codable {
    let timestamp: String
    let message: String
    let severity: String?
}

struct ServiceHealth: Codable {
    let name: String
    let status: String
    let version: String?
}

struct StorageHealth: Codable {
    let totalBytes: Int64
    let usedBytes: Int64
    let freeBytes: Int64
}

struct BackupHealth: Codable {
    let configured: Bool
    let lastRunTime: String?
    let lastRunStatus: String?
    let lastRunSize: Int64?
}

struct MaintenanceState: Codable {
    let mode: String
    let reason: String?
    let scheduledEnd: String?
}

struct AuthStatus: Codable {
    let authenticated: Bool
    let tokenExpiresAt: String?
    let provider: String?
}

struct SystemStatusModelsBackupConfig: Codable {
    let id: String
    let schedule: String?
    let enabled: Bool
}

struct SystemStatusModelsBackupRun: Codable {
    let id: String
    let startedAt: String
    let completedAt: String?
    let status: String
    let sizeBytes: Int64?
}

struct BackupStats: Codable {
    let totalRuns: Int
    let schedulesConfigured: Int
    let lastRunStatus: String?
    let lastRunTime: String?
    let lastRunSize: Int64?
}

struct NotificationStats: Codable {
    let totalSent: Int
    let activeChannels: Int
    let recentFailures: Int
}

struct Vehicle: Codable {
    let id: String
    let displayName: String
    let vin: String?
}

struct ResourceRow {
    let label: String
    let value: String
}

struct HeroChip {
    let label: String
    let icon: String
    let color: Color
}

struct ActionItem {
    let title: String
    let description: String
    let buttonLabel: String
    let action: String
}

// MARK: - Types

import SwiftUI

enum HeroStatus: String {
    case healthy = "Healthy"
    case degraded = "Degraded"
    case unhealthy = "Unhealthy"
    case unknown = "Unknown"
    case maintenance = "Maintenance"

    var iconName: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .unhealthy: "xmark.circle.fill"
        case .unknown: "questionmark.circle.fill"
        case .maintenance: "wrench.and.screwdriver.fill"
        }
    }

    var color: Color {
        switch self {
        case .healthy: .green
        case .degraded: .orange
        case .unhealthy: .red
        case .unknown: .gray
        case .maintenance: .blue
        }
    }
}
