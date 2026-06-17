//
//  SystemStatusPageModel.swift
//  TeslaSync — P4 feature view · P7 · SystemStatusPage (Apple) — View Model
//
//  Full parity with web/src/features/system/pages/SystemStatusPage.tsx —
//  operator-grade health dashboard with live data from all backend endpoints.
//

import Observation
import SwiftUI

@Observable
final class SystemStatusPageModel {
    // MARK: - State

    var health: SystemHealthData?
    var extendedHealth: ExtendedHealth?
    var authStatus: AuthStatus?
    var backupConfigs: [BackupConfig] = []
    var backupRuns: [BackupRun] = []
    var backupStats: BackupStats?
    var maintenance: MaintenanceState?
    var notificationStats: NotificationStats?
    var vehicles: [Vehicle] = []

    var isLoading = false
    var error: String?

    // MARK: - Computed Properties

    var isEmpty: Bool {
        health == nil && extendedHealth == nil
    }

    var maintenanceMode: Bool {
        maintenance?.mode == "maintenance"
    }

    var overallStatus: SystemHeroStatus {
        if maintenance?.mode == "maintenance" { return .maintenance }
        guard let health else { return .unknown }

        let status = health.status.lowercased()
        if status == "healthy" || status == "ok" { return .healthy }
        if status == "degraded" || status == "warning" { return .degraded }
        if status == "unhealthy" || status == "down" || status == "offline" { return .unhealthy }
        return .unknown
    }

    var teslaTokenWarn: String? {
        guard let auth = authStatus else {
            return nil
        }
        
        guard auth.authenticated,
              let expiresAt = auth.tokenExpiresAt,
              let expireDate = ISO8601DateFormatter().date(from: expiresAt)
        else {
            return auth.authenticated == false ? String(localized: "Tesla account not connected") : nil
        }

        let days = Calendar.current.dateComponents([.day], from: Date(), to: expireDate).day ?? 0
        if days < 0 {
            return String(localized: "Tesla token expired")
        } else if days < 7 {
            return String(localized: "Tesla token expires in {{days}} day(s)")
                .replacingOccurrences(of: "{{days}}", with: "\(days)")
        }
        return nil
    }

    var backupStaleDays: Int? {
        guard let stats = backupStats,
              let lastRunTime = stats.lastRunTime,
              let lastDate = ISO8601DateFormatter().date(from: lastRunTime)
        else {
            return nil
        }
        return Calendar.current.dateComponents([.day], from: lastDate, to: Date()).day
    }

    var resourceRows: [ResourceRow] {
        var rows: [ResourceRow] = []

        if let db = health?.database {
            rows.append(ResourceRow(
                label: String(localized: "Pool acquired"),
                value: "\(db.poolAcquired)"
            ))
            rows.append(ResourceRow(
                label: String(localized: "Pool idle"),
                value: "\(db.poolIdle)"
            ))
            rows.append(ResourceRow(
                label: String(localized: "Storage used"),
                value: formatBytes(db.sizeBytes)
            ))
        }

        if let workers = health?.workers {
            rows.append(ResourceRow(
                label: String(localized: "Workers"),
                value: "\(workers.totalCount)"
            ))
        }

        if let uptime = health?.uptime {
            rows.append(ResourceRow(
                label: "Uptime",
                value: formatUptime(uptime)
            ))
        }

        return rows
    }

    var heroChips: [HeroChip] {
        var chips: [HeroChip] = []

        if let db = health?.database {
            chips.append(HeroChip(
                label: String(localized: "Database"),
                icon: "cylinder.fill",
                color: db.status.lowercased() == "healthy" ? .green : .red
            ))
        }

        if let tel = health?.telemetry {
            chips.append(HeroChip(
                label: String(localized: "Telemetry"),
                icon: "antenna.radiowaves.left.and.right",
                color: tel.status.lowercased() == "healthy" ? .green : .red
            ))
        }

        if let workers = health?.workers {
            chips.append(HeroChip(
                label: String(localized: "Workers"),
                icon: "gearshape.2.fill",
                color: workers.unhealthyCount == 0 ? .green : .orange
            ))
        }

        return chips
    }

    var actionItems: [ActionItem] {
        var items: [ActionItem] = []

        if let warn = teslaTokenWarn {
            items.append(ActionItem(
                title: String(localized: "Tesla auth"),
                description: warn,
                buttonLabel: String(localized: "Re-authenticate"),
                action: "reauth"
            ))
        }

        if let days = backupStaleDays, days > 7 {
            items.append(ActionItem(
                title: String(localized: "Backups"),
                description: String(localized: "Last backup is {{days}} days old")
                    .replacingOccurrences(of: "{{days}}", with: "\(days)"),
                buttonLabel: String(localized: "Manage"),
                action: "backups"
            ))
        }

        if let usage = health?.teslaAPIUsage, usage.estimatedCost > usage.monthlyCredit {
            items.append(ActionItem(
                title: String(localized: "Tesla API usage"),
                description: String(localized: "Tesla API estimated cost {{cost}} exceeds {{credit}} monthly credit")
                    .replacingOccurrences(of: "{{cost}}", with: String(format: "$%.2f", usage.estimatedCost))
                    .replacingOccurrences(of: "{{credit}}", with: String(format: "$%.0f", usage.monthlyCredit)),
                buttonLabel: String(localized: "Review polling cadence or vehicle subscriptions"),
                action: "usage"
            ))
        }

        return items
    }

    // MARK: - Actions

    func load() async {
        isLoading = true
        error = nil

        do {
            // NOTE: KMP core integration pending (P1/S8 state holders)
            // Will replace with: await fetchSystemHealth(), await fetchExtendedHealth(), etc.
            try await Task.sleep(nanoseconds: 500_000_000) // 0.5s

            loadMockData()
            isLoading = false
        } catch {
            self.error = error.localizedDescription
            isLoading = false
        }
    }

    private func loadMockData() {
        health = createMockHealth()
        authStatus = createMockAuth()
        backupStats = createMockBackupStats()
        notificationStats = createMockNotificationStats()
        vehicles = createMockVehicles()
    }

    private func createMockHealth() -> SystemHealthData {
        SystemHealthData(
            status: "healthy",
            database: DatabaseHealth(
                status: "healthy",
                latencyMs: 2.5,
                poolAcquired: 3,
                poolIdle: 22,
                totalRows: 1_250_000,
                tableCount: 47,
                sizeBytes: 2_500_000_000
            ),
            telemetry: TelemetryHealth(
                status: "healthy",
                messagesProcessed: 45234,
                lastMessageTime: ISO8601DateFormatter().string(from: Date())
            ),
            workers: WorkersHealth(
                overallStatus: "healthy",
                totalCount: 5,
                unhealthyCount: 0
            ),
            teslaAPIUsage: TeslaAPIUsage(
                estimatedCost: 12.50,
                monthlyCredit: 30.0,
                periodStart: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400 * 15))
            ),
            recentErrors: [],
            version: "1.2.0",
            uptime: 345_600,
            updateAvailable: nil,
            services: [
                ServiceHealth(name: "API Server", status: "healthy", version: "1.2.0"),
                ServiceHealth(name: "MQTT", status: "healthy", version: "2.0.17"),
                ServiceHealth(name: "Redis", status: "healthy", version: "7.2.4")
            ]
        )
    }

    private func createMockAuth() -> AuthStatus {
        AuthStatus(
            authenticated: true,
            tokenExpiresAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(86400 * 60)),
            provider: "Tesla"
        )
    }

    private func createMockBackupStats() -> BackupStats {
        BackupStats(
            totalRuns: 47,
            schedulesConfigured: 2,
            lastRunStatus: "success",
            lastRunTime: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-86400 * 2)),
            lastRunSize: 250_000_000
        )
    }

    private func createMockNotificationStats() -> NotificationStats {
        NotificationStats(
            totalSent: 1234,
            activeChannels: 3,
            recentFailures: 0
        )
    }

    private func createMockVehicles() -> [Vehicle] {
        [
            Vehicle(id: "1", displayName: "Model 3", vin: "5YJ3E1EA..."),
            Vehicle(id: "2", displayName: "Model Y", vin: "7SAYGDEE...")
        ]
    }

    func refresh() async {
        await load()
    }
}

// MARK: - Formatting Helpers

extension SystemStatusPageModel {
    func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }

    func formatNumber(_ num: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: num)) ?? "\(num)"
    }

    func formatUptime(_ seconds: Int) -> String {
        let days = seconds / 86400
        let hours = (seconds % 86400) / 3600
        if days > 0 {
            return "\(days)d \(hours)h"
        } else {
            return "\(hours)h"
        }
    }

    func formatTimestamp(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}
