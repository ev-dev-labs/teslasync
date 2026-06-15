import SwiftUI

/// The restore-preview dialog (web preview `Modal`). Shows the dry-run inspection of a
/// completed backup: the checksum-verification status, the backup metadata, and the tables
/// (with row counts) that would be restored — or a loading state while the preview fetches.
/// All copy resolves from `Localizable.xcstrings` with the web key names.
struct BackupPreviewSheet: View {
    @Bindable var model: BackupRestorePageModel

    var body: some View {
        BackupSheetScaffold(title: "backup.restorePreview") {
            switch model.previewState {
            case .loading:
                loadingView
            case let .loaded(preview):
                content(preview)
            }
        } footer: {
            Spacer(minLength: 0)
            TSButton("common.close", variant: .secondary) {
                model.closePreview()
            }
        }
    }

    private var loadingView: some View {
        VStack(spacing: TSSpacing.md) {
            ProgressView()
            TSCaption("backup.loadingPreview")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
    }

    private func content(_ preview: RestorePreview) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            checksumRow(preview)
            if !preview.metadata.isEmpty {
                metadataSection(preview.metadata)
            }
            tablesSection(preview.tables)
        }
    }

    private func checksumRow(_ preview: RestorePreview) -> some View {
        let verified = preview.checksumVerified
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: verified ? "checkmark.seal.fill" : "xmark.seal.fill")
                .foregroundStyle(verified ? Color.TS.statusSuccess : Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verified ? "backup.checksumVerified" : "backup.checksumFailed")
                .font(Font.TS.body)
                .foregroundStyle(verified ? Color.TS.statusSuccess : Color.TS.statusDanger)
        }
        .accessibilityElement(children: .combine)
    }

    private func metadataSection(_ metadata: [BackupMetaEntry]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("backup.metadata")
            ForEach(metadata) { entry in
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: entry.key).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: TSSpacing.md)
                    TSCode(entry.value)
                }
            }
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func tablesSection(_ tables: [RestorePreviewTable]) -> some View {
        if tables.isEmpty {
            TSEmptyState(title: "backup.noTables", systemImage: "tablecells")
                .frame(maxWidth: .infinity)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    Text("backup.tables")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textSecondary)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: "(\(tables.count))")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                tablesGrid(tables)
            }
        }
    }

    private func tablesGrid(_ tables: [RestorePreviewTable]) -> some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.lg, verticalSpacing: TSSpacing.xs) {
            GridRow {
                Text("backup.table").font(Font.TS.label).foregroundStyle(Color.TS.textSecondary)
                    .accessibilityAddTraits(.isHeader)
                Text("backup.rows").font(Font.TS.label).foregroundStyle(Color.TS.textSecondary)
                    .accessibilityAddTraits(.isHeader)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(2)
            ForEach(tables) { table in
                GridRow {
                    Text(verbatim: table.name)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: BackupRestoreFormat.int(table.rows))
                        .font(Font.TS.bodySm)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
    }
}
