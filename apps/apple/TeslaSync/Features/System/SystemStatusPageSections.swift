import SwiftUI

// MARK: - Section Views for SystemStatusPage

extension SystemStatusPage {
    // MARK: - Resources Section

    var resourcesSection: some View {
        GroupBox(String(localized: "Services & components")) {
            VStack(spacing: 0) {
                Text(
                    String(localized:
                        "CPU %, memory bytes, and disk usage need a new /system/resources endpoint (Phase 2).")
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 12)

                ForEach(Array(model.resourceRows.enumerated()), id: \.offset) { index, row in
                    resourceRow(row)
                    if index < model.resourceRows.count - 1 {
                        Divider()
                    }
                }
            }
        }
    }

    func resourceRow(_ row: ResourceRow) -> some View {
        HStack {
            Text(row.label)
                .font(.subheadline)
            Spacer()
            Text(row.value)
                .font(.subheadline)
                .fontWeight(.medium)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Services Section

    var servicesSection: some View {
        GroupBox(String(localized: "Services")) {
            VStack(spacing: 0) {
                ForEach(
                    Array(model.health?.services.enumerated() ?? [].enumerated()),
                    id: \.offset
                ) { index, service in
                    serviceRow(service)
                    if index < (model.health?.services.count ?? 0) - 1 {
                        Divider()
                    }
                }
            }
        }
    }

    func serviceRow(_ service: ServiceHealth) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(service.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                if let version = service.version {
                    Text(version)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            statusBadge(service.status)
        }
        .padding(.vertical, 8)
    }

    func statusBadge(_ status: String) -> some View {
        Text(status)
            .font(.caption)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(status == "healthy" ? .green : .red)
            .background((status == "healthy" ? Color.green : Color.red).opacity(0.15))
            .clipShape(Capsule())
    }

    // MARK: - Database Section

    var databaseSection: some View {
        GroupBox(String(localized: "Database & connections")) {
            VStack(spacing: 12) {
                if let db = model.health?.database {
                    dbMetricRow(label: String(localized: "Health"), value: db.status)
                    dbMetricRow(label: String(localized: "Latency"), value: "\(Int(db.latencyMs))ms")

                    Divider()

                    Text(String(localized: "Database"))
                        .font(.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    dbMetricRow(label: String(localized: "Pool acquired"), value: "\(db.poolAcquired)")
                    dbMetricRow(label: String(localized: "Pool idle"), value: "\(db.poolIdle)")
                    dbMetricRow(label: String(localized: "Total rows"), value: model.formatNumber(db.totalRows))
                    dbMetricRow(label: String(localized: "Tables"), value: "\(db.tableCount)")
                    dbMetricRow(label: String(localized: "Storage used"), value: model.formatBytes(db.sizeBytes))
                }

                Button(String(localized: "Open DB Health")) {
                    // Navigation
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            }
        }
    }

    func dbMetricRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .font(.subheadline)
            Spacer()
            Text(value)
                .font(.subheadline)
                .fontWeight(.medium)
        }
    }

    // MARK: - Telemetry Section

    var telemetrySection: some View {
        GroupBox(String(localized: "Telemetry pipeline")) {
            VStack(spacing: 12) {
                if let tel = model.health?.telemetry {
                    dbMetricRow(label: String(localized: "Health"), value: tel.status)

                    let countStr = String(localized: "{{count}} since {{uptime}} ago")
                        .replacingOccurrences(of: "{{count}}", with: model.formatNumber(tel.messagesProcessed))
                        .replacingOccurrences(of: "{{uptime}}", with: model.formatUptime(model.health?.uptime ?? 0))

                    Text(countStr)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(String(localized: "Open Live Monitor")) {
                    // Navigation
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Tesla Auth Section

    var teslaAuthSection: some View {
        GroupBox(String(localized: "Tesla auth")) {
            VStack(spacing: 12) {
                if let auth = model.authStatus {
                    if auth.authenticated {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(String(localized: "Connect"))
                                    .font(.subheadline)
                                    .fontWeight(.medium)

                                if let warn = model.teslaTokenWarn {
                                    Text(warn)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                } else {
                                    Text(String(localized: "Connect your Tesla account to fetch vehicle data"))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            if model.teslaTokenWarn != nil {
                                Button(String(localized: "Re-authenticate")) {
                                    // Action
                                }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                            }
                        }
                    } else {
                        Text(String(localized: "Tesla account not connected"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Button(String(localized: "Connect")) {
                            // Action
                        }
                        .buttonStyle(.borderedProminent)
                        .frame(maxWidth: .infinity)
                    }
                }

                Button(String(localized: "Open Tesla API logs")) {
                    // Navigation
                }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - Notifications Section

    var notificationsSection: some View {
        GroupBox(String(localized: "Notifications & audit")) {
            VStack(spacing: 12) {
                if let stats = model.notificationStats {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(String(localized: "Sent (lifetime)"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(stats.totalSent)")
                                .font(.title3)
                                .fontWeight(.semibold)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text(String(localized: "Channels"))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Text("\(stats.activeChannels)")
                                .font(.title3)
                                .fontWeight(.semibold)
                        }
                    }

                    if stats.recentFailures > 0 {
                        Text(String(localized: "Failures (recent)") + ": \(stats.recentFailures)")
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                Button(String(localized: "Open Notifications")) {
                    // Navigation
                }
                .buttonStyle(.borderedProminent)
                .frame(maxWidth: .infinity)
            }
        }
    }
}
