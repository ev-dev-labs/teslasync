import SwiftUI

// MARK: - Additional Section Views for SystemStatusPage

extension SystemStatusPage {
    // MARK: - Workers Section

    var workersSection: some View {
        GroupBox(String(localized: "Background workers")) {
            VStack(spacing: 12) {
                if let workers = model.health?.workers {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(localized: "Health"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text(workers.overallStatus)
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text(String(localized: "Workers"))
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            if workers.unhealthyCount > 0 {
                                let downStr = String(localized: "{{down}} of {{total}} workers unhealthy")
                                    .replacingOccurrences(of: "{{down}}", with: "\(workers.unhealthyCount)")
                                    .replacingOccurrences(of: "{{total}}", with: "\(workers.totalCount)")
                                Text(downStr)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.orange)
                            } else {
                                Text("\(workers.totalCount)")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                            }
                        }
                    }

                    if workers.unhealthyCount > 0 {
                        Text(String(localized: "Review polling cadence or vehicle subscriptions"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    // MARK: - Backups Section

    var backupsSection: some View {
        GroupBox(String(localized: "Backups")) {
            VStack(spacing: 12) {
                if let backup = model.backupStats {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(localized: "Total runs"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(backup.totalRuns)")
                                .font(.title3)
                                .fontWeight(.semibold)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text(String(localized: "Configured schedules"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(backup.schedulesConfigured)")
                                .font(.title3)
                                .fontWeight(.semibold)
                        }
                    }

                    if backup.totalRuns == 0 {
                        Text(String(localized: "No backups recorded"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if backup.schedulesConfigured == 0 {
                        Text(String(localized: "Not configured"))
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if backup.lastRunStatus == "success" {
                        if let days = model.backupStaleDays {
                            if days == 0 {
                                Text(String(localized: "Last backup: today"))
                                    .font(.caption)
                                    .foregroundStyle(.green)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else if days > 7 {
                                let warnStr = String(localized: "Last backup is {{days}} days old")
                                    .replacingOccurrences(of: "{{days}}", with: "\(days)")
                                Text(warnStr)
                                    .font(.caption)
                                    .foregroundStyle(.orange)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            } else {
                                let okStr = String(localized: "Last backup: {{days}}d ago")
                                    .replacingOccurrences(of: "{{days}}", with: "\(days)")
                                Text(okStr)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }

                        if let size = backup.lastRunSize {
                            Text(String(localized: "Last successful size") + ": \(model.formatBytes(size))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else if backup.lastRunStatus == "failed" {
                        Text(String(localized: "Failed"))
                            .font(.caption)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else if backup.lastRunStatus == "pending" {
                        Text(String(localized: "Pending"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Text(String(localized: "Configured · no successful run yet"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    HStack(spacing: 12) {
                        Button(String(localized: "Manage backups")) {
                            // Navigation
                        }
                        .buttonStyle(.bordered)
                        .frame(maxWidth: .infinity)

                        if backup.totalRuns == 0 {
                            Button(String(localized: "Set up backups")) {
                                // Action
                            }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                        } else if backup.schedulesConfigured == 0 || backup.lastRunStatus == "failed" {
                            let buttonLabel = backup.schedulesConfigured == 0
                                ? String(localized: "Configure a schedule or run one now")
                                : String(localized: "Run a backup or check the schedule")
                            Button(buttonLabel) {
                                // Action
                            }
                            .buttonStyle(.borderedProminent)
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Tesla API Section

    var teslaAPISection: some View {
        GroupBox(String(localized: "Tesla API usage")) {
            VStack(spacing: 12) {
                if let usage = model.health?.teslaAPIUsage {
                    let costStr = String(localized: "{{cost}} of {{credit}} estimated this period")
                        .replacingOccurrences(of: "{{cost}}", with: String(format: "$%.2f", usage.estimatedCost))
                        .replacingOccurrences(of: "{{credit}}", with: String(format: "$%.0f", usage.monthlyCredit))

                    Text(costStr)
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    if usage.estimatedCost > usage.monthlyCredit {
                        let exceedStr = String(
                            localized: "Tesla API estimated cost {{cost}} exceeds {{credit}} monthly credit"
                        )
                        .replacingOccurrences(of: "{{cost}}", with: String(format: "$%.2f", usage.estimatedCost))
                        .replacingOccurrences(of: "{{credit}}", with: String(format: "$%.0f", usage.monthlyCredit))
                        Text(exceedStr)
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    // MARK: - Errors Section

    var errorsSection: some View {
        GroupBox(String(localized: "Recent errors")) {
            VStack(spacing: 12) {
                if let errors = model.health?.recentErrors, !errors.isEmpty {
                    ForEach(errors, id: \.timestamp) { error in
                        errorRow(error)
                    }

                    Button(String(localized: "Open error logs")) {
                        // Navigation
                    }
                    .buttonStyle(.borderedProminent)
                    .frame(maxWidth: .infinity)
                } else {
                    Text(String(localized: "No errors recorded recently."))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    func errorRow(_ error: ErrorLog) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(error.message)
                .font(.caption)
                .fontWeight(.medium)
            Text(model.formatTimestamp(error.timestamp))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
    }

    // MARK: - System Info Section

    var systemInfoSection: some View {
        GroupBox(String(localized: "System info")) {
            VStack(spacing: 8) {
                if let health = model.health {
                    let currentStr = String(localized: "Current: v{{current}}")
                        .replacingOccurrences(of: "{{current}}", with: health.version)
                    dbMetricRow(label: String(localized: "Version, build, runtime"), value: currentStr)

                    if let update = health.updateAvailable {
                        let updateStr = String(localized: "Update available — v{{version}}")
                            .replacingOccurrences(of: "{{version}}", with: update)
                        HStack {
                            Text(updateStr)
                                .font(.caption)
                                .foregroundStyle(.orange)
                            Spacer()
                            Button(String(localized: "Release notes")) {
                                // Action
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Uptime Section

    var uptimeSection: some View {
        GroupBox {
            VStack(spacing: 8) {
                Text(String(localized: "Telemetry"))
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                let uptimeText = String(
                    localized:
                        // swiftlint:disable:next line_length
                        "Today reflects the current status. Day-level historical data ships with the backend health-history endpoint in Phase 2."
                )
                Text(uptimeText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - SLO Section

    var sloSection: some View {
        GroupBox {
            VStack(spacing: 8) {
                Text("SLO")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(String(localized: "Run health check")) {
                    Task { await model.refresh() }
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Maintenance Section

    var maintenanceSection: some View {
        GroupBox {
            VStack(spacing: 8) {
                Label(
                    String(localized: "Maintenance mode is active"),
                    systemImage: "wrench.and.screwdriver.fill"
                )
                .font(.headline)
                .foregroundStyle(.orange)
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(String(localized: "System is in operator-set maintenance mode"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button(String(localized: "Manage")) {
                    // Navigation
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            }
        }
        .background(Color.orange.opacity(0.1))
    }

    // MARK: - Subscribe Section

    var subscribeSection: some View {
        GroupBox {
            VStack(spacing: 8) {
                Text("Subscribe")
                    .font(.headline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text("SSE endpoint for live updates")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: - API Docs Section

    var apiDocsSection: some View {
        GroupBox {
            VStack(spacing: 8) {
                Text(String(localized: "Stable Status API for your own dashboards"))
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Button("View API Documentation") {
                    // Action
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
            }
        }
    }
}
