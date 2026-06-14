import SwiftUI

/// The adaptive flag registry table for `FeatureFlagsPage` (web `FlagsTable`,
/// `GlassPanel1`): a columnar grid on macOS / iPad regular width and per-row cards on
/// compact iPhone. Reproduces the three web columns — the monospaced flag key (sorted
/// ascending, web `useSortToggle('key','asc')`), the JSON value preview (web
/// `previewValue`), and the per-row Edit + Delete actions. Kept as a dedicated surface
/// (mirroring `AuditLogEntriesTable`) so the page file stays focused on chrome + states.
/// All copy resolves from `Localizable.xcstrings`.
struct FeatureFlagsTable: View {
    let rows: [FeatureFlagEntry]
    let model: FeatureFlagsPageModel

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

    /// Web `FlagsTable` sorts by key ascending by default.
    private var sortedRows: [FeatureFlagEntry] {
        rows.sorted { $0.key.localizedCompare($1.key) == .orderedAscending }
    }

    var body: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                ForEach(sortedRows) { rowCard($0) }
            }
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                header("admin.flags.cols.key")
                header("admin.flags.cols.value")
                header("admin.flags.cols.actions").gridColumnAlignment(.trailing)
            }
            Divider().overlay(Color.TS.border).gridCellColumns(3)
            ForEach(sortedRows) { row in
                GridRow {
                    keyText(row.key)
                    valueText(row.valuePreview)
                    rowActions(row)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: row.key))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(3)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func keyText(_ key: String) -> some View {
        Text(verbatim: key)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .textSelection(.enabled)
    }

    private func valueText(_ preview: String) -> some View {
        Text(verbatim: preview)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(2)
            .textSelection(.enabled)
    }

    private func rowActions(_ row: FeatureFlagEntry) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .secondary, size: .small) {
                model.beginEdit(row)
            } label: {
                Label("admin.flags.actions.edit", systemImage: "pencil")
            }
            TSButton(variant: .destructive, size: .small) {
                model.askDelete(row)
            } label: {
                Label("admin.flags.actions.delete", systemImage: "trash")
            }
        }
    }

    // MARK: - Compact (iPhone) cards

    private func rowCard(_ row: FeatureFlagEntry) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: row.key)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                VStack(alignment: .leading, spacing: 2) {
                    Text("admin.flags.cols.value")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Text(verbatim: row.valuePreview)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.TS.textSecondary)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                rowActions(row)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
