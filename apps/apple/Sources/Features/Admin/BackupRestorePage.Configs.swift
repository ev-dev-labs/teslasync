import SwiftUI

/// The data-state switch for the Backup Configurations panel (web GlassPanel5 body):
/// loading → table skeleton, empty → `EmptyState` with a New Config action, error →
/// retryable error view, success → the adaptive configurations table. Never a blank region.
struct BackupConfigsSection: View {
    let model: BackupRestorePageModel

    var body: some View {
        switch model.configsState {
        case .loading:
            TSTableSkeleton(rows: 4)
                .accessibilityLabel(Text("backup.configurations"))
        case .empty:
            TSEmptyState(
                title: "backup.noConfigs",
                message: "backup.noConfigsMessage",
                systemImage: "externaldrive.badge.xmark"
            ) {
                TSButton("backup.newConfig", size: .small) { model.openCreate() }
            }
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadConfigs() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(rows):
            BackupConfigsTable(rows: rows, model: model)
        }
    }
}

/// The adaptive configurations table (web `DataTable` of `configColumns`): a columnar grid
/// on macOS / iPad regular width and per-row cards on compact iPhone. Reproduces the web
/// columns — name (+ Disabled badge), type, provider, frequency, schedule, options — plus
/// the per-row Trigger / Edit / Delete actions.
struct BackupConfigsTable: View {
    let rows: [BackupConfig]
    let model: BackupRestorePageModel

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
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("backup.name")
                header("backup.type")
                header("backup.provider")
                header("backup.frequency")
                header("backup.schedule")
                header("backup.options")
                Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(rows) { row in
                GridRow {
                    nameCell(row)
                    typeCell(row)
                    BackupProviderBadge(provider: row.provider)
                    frequencyCell(row)
                    scheduleCell(row)
                    optionsCell(row)
                    actionsCell(row).frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: row.name))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(7)
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

    private func nameCell(_ row: BackupConfig) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: row.name).font(Font.TS.body).foregroundStyle(Color.TS.textPrimary)
            if !row.enabled { TSBadge("backup.disabled", tone: .neutral) }
        }
    }

    private func typeCell(_ row: BackupConfig) -> some View {
        TSBadge(
            row.backupType == .full ? "backup.full" : "backup.incremental",
            tone: row.backupType == .full ? .info : .warning
        )
    }

    @ViewBuilder
    private func frequencyCell(_ row: BackupConfig) -> some View {
        if row.frequencyDays == 1 {
            Text("backup.daily").font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
        } else {
            Text(verbatim: String(format: String(localized: "backup.everyNDays"), row.frequencyDays))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private func scheduleCell(_ row: BackupConfig) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            scheduleRow(label: "backup.lastRun", iso: row.lastRunAt)
            scheduleRow(label: "backup.nextRun", iso: row.nextRunAt)
        }
    }

    private func scheduleRow(label: LocalizedStringKey, iso: String?) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Text(verbatim: BackupRestoreFormat.relative(iso))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private func optionsCell(_ row: BackupConfig) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if row.compress { TSBadge("backup.compress", tone: .neutral) }
            if row.encrypt { TSBadge("backup.encrypt", tone: .warning) }
        }
    }

    private func actionsCell(_ row: BackupConfig) -> some View {
        HStack(spacing: TSSpacing.xs) {
            TSButton(variant: .ghost, size: .small, isLoading: model.triggeringConfigID == row.id) {
                Task { await model.trigger(row) }
            } label: {
                Image(systemName: "play.fill")
            }
            .accessibilityLabel(Text("backup.triggerNow"))
            TSButton(variant: .ghost, size: .small) {
                model.openEdit(row)
            } label: {
                Image(systemName: "pencil")
            }
            .accessibilityLabel(Text("backup.edit"))
            TSButton(variant: .destructive, size: .small) {
                model.askDelete(row)
            } label: {
                Image(systemName: "trash")
            }
            .accessibilityLabel(Text("backup.delete"))
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: BackupConfig) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                nameCell(row)
                HStack(spacing: TSSpacing.xs) {
                    typeCell(row)
                    BackupProviderBadge(provider: row.provider)
                }
                cardField(label: "backup.frequency") { frequencyCell(row) }
                cardField(label: "backup.schedule") { scheduleCell(row) }
                optionsCell(row)
                actionsCell(row).frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func cardField(label: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            content()
        }
    }
}
