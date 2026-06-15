import SwiftUI

/// The adaptive run-history table (web `DataTable` of `runColumns`): a horizontally
/// scrollable columnar grid on macOS / iPad regular width and per-row cards on compact
/// iPhone. Reproduces the web columns — time, run type, status, provider, file, size,
/// records, duration — plus the per-row Download / Verify / Preview actions shown only for
/// completed runs.
struct BackupRunsTable: View {
    let rows: [BackupRun]
    let model: BackupRestorePageModel

    @Environment(\.openURL) private var openURL
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

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
                ForEach(rows) { rowCard($0) }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                regularTable
            }
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("backup.time")
                header("backup.runType")
                header("backup.status")
                header("backup.provider")
                header("backup.file")
                header("backup.size")
                header("backup.records")
                header("backup.duration")
                Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(9)
            ForEach(rows) { row in
                GridRow {
                    timeCell(row)
                    BackupRunTypeBadge(runType: row.runType)
                    BackupStatusBadge(status: row.status)
                    BackupProviderBadge(provider: row.provider)
                    fileCell(row)
                    sizeCell(row)
                    recordsCell(row)
                    durationCell(row)
                    actionsCell(row).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(9)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - Cells (shared by grid + cards)

    private func timeCell(_ row: BackupRun) -> some View {
        Text(verbatim: BackupRestoreFormat.dateTime(row.createdAt))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func fileCell(_ row: BackupRun) -> some View {
        Text(verbatim: row.fileName ?? BackupRestoreFormat.emptyValue)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .truncationMode(.middle)
    }

    private func sizeCell(_ row: BackupRun) -> some View {
        Text(verbatim: row.fileSize > 0 ? BackupRestoreFormat.bytes(row.fileSize) : BackupRestoreFormat.emptyValue)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textPrimary)
    }

    private func recordsCell(_ row: BackupRun) -> some View {
        Text(verbatim: row.recordCount > 0 ? BackupRestoreFormat.int(row.recordCount) : BackupRestoreFormat.emptyValue)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textSecondary)
    }

    private func durationCell(_ row: BackupRun) -> some View {
        Text(verbatim: row.durationMs > 0 ? BackupRestoreFormat.durationMs(row.durationMs) : BackupRestoreFormat
            .emptyValue)
            .font(Font.TS.bodySm)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textMuted)
    }

    @ViewBuilder
    private func actionsCell(_ row: BackupRun) -> some View {
        if row.isCompleted {
            HStack(spacing: TSSpacing.xs) {
                TSButton(variant: .ghost, size: .small) {
                    if let url = model.downloadURL(for: row) { openURL(url) }
                } label: {
                    Image(systemName: "arrow.down.circle")
                }
                .accessibilityLabel(Text("backup.download"))
                TSButton(variant: .ghost, size: .small, isLoading: model.verifyingRunID == row.id) {
                    Task { await model.verify(row) }
                } label: {
                    Image(systemName: "checkmark.shield")
                }
                .accessibilityLabel(Text("backup.verify"))
                TSButton(variant: .ghost, size: .small) {
                    Task { await model.openPreview(row) }
                } label: {
                    Image(systemName: "eye")
                }
                .accessibilityLabel(Text("backup.preview"))
            }
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: BackupRun) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    BackupRunTypeBadge(runType: row.runType)
                    BackupStatusBadge(status: row.status)
                    BackupProviderBadge(provider: row.provider)
                }
                timeCell(row)
                cardMetrics(row)
                fileCell(row)
                actionsCell(row).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func cardMetrics(_ row: BackupRun) -> some View {
        HStack(spacing: TSSpacing.lg) {
            cardMetric(label: "backup.size") { sizeCell(row) }
            cardMetric(label: "backup.records") { recordsCell(row) }
            cardMetric(label: "backup.duration") { durationCell(row) }
        }
    }

    private func cardMetric(label: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            content()
        }
    }
}
