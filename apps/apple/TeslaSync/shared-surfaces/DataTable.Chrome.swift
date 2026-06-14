//
//  DataTable.Chrome.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The data table's toolbar + the composition seams for the sibling surfaces it integrates. The web `DataTable`
//  toolbar pairs the `DataTableBulkBar` (selection actions) with the CSV export `<button>` and the
//  `DataTableColumnMenu` (visibility / reorder popover); the footer is a `Pagination`. This file owns the
//  native peer of the toolbar (``DataTableToolbar``), the ``DataTableComposition`` factory that wires the
//  composed ``PaginationController`` / ``DataTableColumnMenuController`` to the owning ``DataTableModel``, and
//  the ``DataTableCSVDocument`` the system file-exporter writes (the native peer of the web `downloadCSV`).
//  Those sibling surfaces are each their own prompt (0209 / 0210 / 0221) and out of scope here — this file only
//  composes their public APIs. All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import SwiftUI
import UniformTypeIdentifiers

// MARK: - DataTableComposition (wire composed controllers to the model)

/// Builds the composed sibling controllers, wiring their callbacks back to the owning ``DataTableModel``. The
/// model is the single owner of page / page-size / layout (the web DataTable owns those `useState`s and feeds
/// the children as controlled props); these factories simply route the children's change events into it. The
/// callbacks bridge to the model's `@MainActor` mutators through ``MainActor/assumeIsolated(_:)`` — safe
/// because the controllers invoke them on the main actor.
public enum DataTableComposition {
    /// The composed pager controller (web the `<Pagination>` child) — page / size changes route to the model.
    @MainActor
    public static func pagination(
        _ model: DataTableModel,
        config: DataTablePagination?,
        total: Int
    ) -> PaginationController {
        PaginationController(
            page: 1,
            pageSize: config?.defaultPageSize ?? 25,
            total: total,
            pageSizeOptions: config?.pageSizeOptions ?? [20, 50, 100],
            onPageChange: { value in MainActor.assumeIsolated { model.setPage(value) } },
            onPageSizeChange: { value in MainActor.assumeIsolated { model.setPageSize(value) } }
        )
    }

    /// The composed column-menu controller (web the `<DataTableColumnMenu>` child) — layout changes route to
    /// the model, which is the single source of truth the table renders from.
    @MainActor
    public static func columnMenu(
        _ model: DataTableModel,
        specs: [DataTableColumnSpec],
        toggleable: Bool,
        reorderable: Bool
    ) -> DataTableColumnMenuController {
        DataTableColumnMenuController(
            columns: specs.map {
                ColumnDescriptor(key: $0.key, header: $0.header, isRequired: false, defaultVisible: $0.defaultVisible)
            },
            layout: nil,
            reorderable: reorderable,
            toggleable: toggleable,
            onChange: { layout in MainActor.assumeIsolated { model.setLayout(layout) } },
            onReset: { MainActor.assumeIsolated { model.resetLayout() } }
        )
    }
}

// MARK: - DataTableToolbar (web toolbar row)

/// The toolbar — the native peer of the web toolbar `<div>`: the selection bulk bar on the leading edge (the
/// composed ``DataTableBulkBar``, shown while a selection exists), then the CSV export control and the column
/// visibility / reorder menu (the composed ``DataTableColumnMenu``) on the trailing edge. Rendered by the table
/// only when at least one of these is relevant (web `showToolbar`).
public struct DataTableToolbar: View {
    let exportable: Bool
    let exporting: Bool
    let exportDisabled: Bool
    let onExport: @MainActor () -> Void
    let showsColumnMenu: Bool
    let columnMenuController: DataTableColumnMenuController
    let selectionEnabled: Bool
    let selectedCount: Int
    let onClearSelection: @MainActor () -> Void
    let bulkActions: AnyView?

    public var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            bulkBar
            Spacer(minLength: 0)
            if exportable {
                exportButton
            }
            if showsColumnMenu {
                DataTableColumnMenu(controller: columnMenuController)
            }
        }
    }

    /// The selection bulk bar (web `selectedRows.length > 0 && <DataTableBulkBar>`). The actions slot is only
    /// passed when the caller supplied one, so the composed bar's own "has actions" heuristic stays accurate.
    @ViewBuilder
    private var bulkBar: some View {
        if selectionEnabled, selectedCount > 0 {
            if let bulkActions {
                DataTableBulkBar(count: selectedCount, onClear: onClearSelection) { bulkActions }
            } else {
                DataTableBulkBar(count: selectedCount, onClear: onClearSelection)
            }
        }
    }

    /// The CSV export control — the web export `<button>`: a spinner while exporting (web `Loader2`), else a
    /// download glyph (web `Download`) + the "Download CSV" label; disabled while exporting or with no rows.
    private var exportButton: some View {
        Button(action: onExport) {
            HStack(spacing: TSSpacing.xs) {
                if exporting {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "arrow.down.circle")
                        .accessibilityHidden(true)
                }
                Text(verbatim: DataTableStrings.exportButtonLabel)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: DataTableMetrics.separatorWidth)
            )
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(exportDisabled)
        .opacity(exportDisabled ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: DataTableStrings.exportAccessibilityLabel))
    }
}

// MARK: - DataTableCSVDocument (web `downloadCSV`)

/// The exported CSV as a `FileDocument` — the native peer of the web `downloadCSV`: the system file exporter
/// writes the UTF-8 CSV text to a `.csv` the user chooses, the HIG-idiomatic peer of the browser download.
public struct DataTableCSVDocument: FileDocument {
    public static var readableContentTypes: [UTType] {
        [.commaSeparatedText]
    }

    public static var writableContentTypes: [UTType] {
        [.commaSeparatedText]
    }

    /// The CSV body.
    public var text: String

    public init(text: String) {
        self.text = text
    }

    public init(configuration: ReadConfiguration) throws {
        if let data = configuration.file.regularFileContents, let decoded = String(data: data, encoding: .utf8) {
            text = decoded
        } else {
            text = ""
        }
    }

    public func fileWrapper(configuration _: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: Data(text.utf8))
    }
}
