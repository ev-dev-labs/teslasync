// DBHealthPage — extracted panels (migration status + connection pool)
import SwiftUI

extension DBHealthPage {
    // Panel 6: Migration Status (web sidebar GlassPanel)
    var migrationStatusPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("translation.dbHealth.migrationTitle")

                if let migration = model.migrationStatus {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        // Current version
                        HStack {
                            Text("translation.dbHealth.currentVersion")
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                            Spacer()
                            Text(verbatim: migration.currentVersion)
                                .font(Font.TS.bodySm)
                                .fontWeight(.semibold)
                                .monospacedDigit()
                                .foregroundStyle(Color.TS.textPrimary)
                        }

                        // Status (dirty/clean)
                        HStack {
                            Text("translation.dbHealth.status")
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                            Spacer()
                            Text(migration.dirty ? "translation.dbHealth.dirty" : "translation.dbHealth.clean")
                                .font(Font.TS.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(migration.dirty ? Color.TS.statusDanger : Color.TS.statusSuccess)
                        }

                        // Pending count (if > 0)
                        if migration.pending > 0 {
                            HStack {
                                Text("translation.dbHealth.pending")
                                    .font(Font.TS.caption)
                                    .foregroundStyle(Color.TS.textMuted)
                                Spacer()
                                Text(verbatim: "\(migration.pending)")
                                    .font(Font.TS.caption)
                                    .fontWeight(.medium)
                                    .foregroundStyle(Color.TS.statusWarning)
                            }
                        }

                        // Recent migrations list
                        if !migration.migrations.isEmpty {
                            Divider().background(Color.TS.border.opacity(0.5))
                            Text("translation.dbHealth.recentMigrations")
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                                .textCase(.uppercase)

                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(migration.migrations.prefix(5).reversed()) { mig in
                                    HStack(spacing: TSSpacing.xs) {
                                        Text(verbatim: "v\(mig.version) \(mig.name)")
                                            .font(Font.TS.caption)
                                            .fontWeight(.medium)
                                            .monospacedDigit()
                                            .foregroundStyle(Color.TS.textSecondary)
                                            .lineLimit(1)
                                            .truncationMode(.tail)
                                        Spacer()
                                        if let appliedAt = mig.appliedAt {
                                            Text(verbatim: appliedAt)
                                                .font(.system(size: 10))
                                                .foregroundStyle(Color.TS.textMuted)
                                        }
                                    }
                                }
                            }
                        } else {
                            TSEmptyState(
                                title: "translation.dbHealth.noMigrations.title",
                                message: "translation.dbHealth.noMigrations",
                                systemImage: "arrow.triangle.branch"
                            )
                            .frame(maxWidth: .infinity, minHeight: 80)
                        }
                    }
                } else {
                    TSEmptyState(
                        title: "translation.dbHealth.noMigrationData.title",
                        message: "translation.dbHealth.noMigrationData",
                        systemImage: "arrow.triangle.branch"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
        }
        .accessibilityIdentifier("migration-status-panel")
    }

    // Panel 7: Connection Pool (web sidebar GlassPanel)
    var connectionPoolPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("translation.dbHealth.poolTitle")

                if let pool = model.connectionPool {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        // Pool metrics
                        poolMetric("translation.dbHealth.pool.maxOpen", "\(pool.maxOpen)")
                        poolMetric("translation.dbHealth.pool.open", "\(pool.open)")
                        poolMetric("translation.dbHealth.pool.inUse", "\(pool.inUse)")
                        poolMetric("translation.dbHealth.pool.idle", "\(pool.idle)")
                        poolMetric("translation.dbHealth.pool.waitCount", "\(pool.waitCount)")
                        poolMetric("translation.dbHealth.pool.waitDuration", "\(pool.waitDurationMs)ms")

                        // Usage bar (web poolUsage + progress bar)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text("translation.dbHealth.poolUsage")
                                    .font(Font.TS.caption)
                                    .foregroundStyle(Color.TS.textMuted)
                                Spacer()
                                Text(verbatim: String(format: "%.0f%%", model.poolUsagePercent))
                                    .font(Font.TS.caption)
                                    .monospacedDigit()
                                    .foregroundStyle(Color.TS.textMuted)
                            }
                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    // Background
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(Color.TS.border.opacity(0.3))
                                        .frame(height: 8)
                                    // Progress
                                    RoundedRectangle(cornerRadius: 4)
                                        .fill(
                                            model.poolUsagePercent >= 80
                                                ? Color.TS.statusDanger
                                                : TSChartPalette.color(at: 0)
                                        )
                                        .frame(
                                            width: geometry.size.width * model.poolUsagePercent / 100.0,
                                            height: 8
                                        )
                                }
                            }
                            .frame(height: 8)
                        }
                    }
                } else {
                    TSEmptyState(
                        title: "translation.dbHealth.noPoolData.title",
                        message: "translation.dbHealth.noPoolData",
                        systemImage: "server.rack"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                }
            }
        }
        .accessibilityIdentifier("connection-pool-panel")
    }

    private func poolMetric(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer()
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
    }

    func formatTimestamp(_ date: Date) -> String {
        let now = Date()
        let interval = now.timeIntervalSince(date)

        if interval < 60 {
            return "now"
        } else if interval < 3600 {
            return "\(Int(interval / 60))m ago"
        } else if interval < 86400 {
            return "\(Int(interval / 3600))h ago"
        } else {
            return "\(Int(interval / 86400))d ago"
        }
    }
}
