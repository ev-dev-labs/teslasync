import SwiftUI

/// The adaptive database tables table for `DBHealthPage` (web `DataTable<TableInfo>`):
/// a columnar grid on macOS / iPad regular width and per-table cards on compact iPhone
/// width. Reproduces the five web columns — Name (with large-table warning icon), Rows,
/// Size, Indexes, Last Vacuum. Kept as a dedicated surface so the page file stays
/// focused on chrome + states. All copy resolves from `Localizable.xcstrings`.
struct DBHealthTable: View {
    let rows: [DBTableInfo]

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// 100MB threshold for marking tables as large (web `LARGE_TABLE_THRESHOLD`).
    private static let largeTableThreshold: Int64 = 100 * 1024 * 1024

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(rows) { tableCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("translation.dbHealth.table.name").gridColumnAlignment(.leading)
                header("translation.dbHealth.table.rows").gridColumnAlignment(.trailing)
                header("translation.dbHealth.table.size").gridColumnAlignment(.trailing)
                header("translation.dbHealth.table.indexes").gridColumnAlignment(.trailing)
                header("translation.dbHealth.table.lastVacuum").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(5)
            ForEach(rows) { row in
                GridRow {
                    nameCell(row)
                    numericCell(formatInt(row.rowCount))
                    numericCell(formatBytes(row.sizeBytes))
                    numericCell(String(row.indexCount))
                    vacuumCell(row.lastVacuum)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(5)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func nameCell(_ row: DBTableInfo) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if row.sizeBytes > Self.largeTableThreshold {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Large table warning")
            }
            Text(verbatim: row.name)
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(
                    row.sizeBytes > Self.largeTableThreshold
                        ? .orange
                        : Color.TS.textPrimary
                )
        }
    }

    private func numericCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func vacuumCell(_ timestamp: String?) -> some View {
        Text(verbatim: formatTimestamp(timestamp))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    // MARK: - Compact (iPhone) cards

    private func tableCard(_ row: DBTableInfo) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                // Name + warning
                HStack(spacing: TSSpacing.xs) {
                    if row.sizeBytes > Self.largeTableThreshold {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(.orange)
                    }
                    Text(verbatim: row.name)
                        .font(Font.TS.body)
                        .fontWeight(.semibold)
                        .foregroundStyle(
                            row.sizeBytes > Self.largeTableThreshold
                                ? .orange
                                : Color.TS.textPrimary
                        )
                }

                // Metrics grid
                Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.xs) {
                    GridRow {
                        metricLabel("translation.dbHealth.table.rows")
                        metricValue(formatInt(row.rowCount))
                    }
                    GridRow {
                        metricLabel("translation.dbHealth.table.size")
                        metricValue(formatBytes(row.sizeBytes))
                    }
                    GridRow {
                        metricLabel("translation.dbHealth.table.indexes")
                        metricValue(String(row.indexCount))
                    }
                    GridRow {
                        metricLabel("translation.dbHealth.table.lastVacuum")
                        metricValue(formatTimestamp(row.lastVacuum))
                    }
                }
            }
            .padding(TSSpacing.md)
        }
    }

    private func metricLabel(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .gridColumnAlignment(.leading)
    }

    private func metricValue(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
            .gridColumnAlignment(.trailing)
    }

    // MARK: - Formatters

    private func formatInt(_ value: Int64) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }

    private func formatBytes(_ bytes: Int64) -> String {
        if bytes < 1024 {
            return "\(bytes) B"
        }
        if bytes < 1024 * 1024 {
            return String(format: "%.1f KB", Double(bytes) / 1024.0)
        }
        if bytes < 1024 * 1024 * 1024 {
            return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
        }
        return String(format: "%.2f GB", Double(bytes) / (1024.0 * 1024.0 * 1024.0))
    }

    private func formatTimestamp(_ timestamp: String?) -> String {
        guard let timestamp = timestamp else { return "—" }
        // Parse ISO 8601 and format as relative time
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: timestamp) else { return timestamp }

        let interval = Date().timeIntervalSince(date)
        if interval < 3600 {
            let mins = Int(interval / 60)
            return "\(mins)m ago"
        }
        if interval < 86400 {
            let hours = Int(interval / 3600)
            return "\(hours)h ago"
        }
        let days = Int(interval / 86400)
        return "\(days)d ago"
    }
}
