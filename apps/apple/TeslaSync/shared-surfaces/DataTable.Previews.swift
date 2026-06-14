//
//  DataTable.Previews.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  Xcode previews for every real branch + feature of the data table: the base populated table, an active
//  sort, multi-selection with the bulk bar + CSV export, single selection, expandable row drawers, per-column
//  resize + the column visibility/reorder menu, pagination, the empty state, the error fallback (reached via a
//  duplicate-key collision), and the compact density. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A sample row for the previews — a vehicle summary, the kind of data a real fleet table renders.
    private struct DataTablePreviewVehicle: Identifiable {
        let id: String
        let name: String
        let model: String
        let soc: Int
        let odometer: Int
    }

    private let dataTablePreviewVehicles: [DataTablePreviewVehicle] = [
        .init(id: "1", name: "Aurora", model: "Model S", soc: 82, odometer: 24180),
        .init(id: "2", name: "Comet", model: "Model 3", soc: 47, odometer: 11902),
        .init(id: "3", name: "Nova", model: "Model X", soc: 95, odometer: 38540),
        .init(id: "4", name: "Vega", model: "Model Y", soc: 12, odometer: 6338),
        .init(id: "5", name: "Orion", model: "Model 3", soc: 63, odometer: 19775),
        .init(id: "6", name: "Lyra", model: "Model S", soc: 100, odometer: 41210)
    ]

    @MainActor
    private func dataTablePreviewColumns() -> [DataTableColumn<DataTablePreviewVehicle>] {
        [
            DataTableColumn(key: "name", header: "Name", sortable: true) { row in
                Text(verbatim: row.name).fontWeight(.medium)
            }
            .exportingText { $0.name },
            DataTableColumn(key: "model", header: "Model") { row in
                Text(verbatim: row.model).foregroundStyle(Color.TS.textSecondary)
            }
            .exportingText { $0.model },
            DataTableColumn(
                key: "soc",
                header: "SoC",
                sortable: true,
                alignment: .trailing
            ) { row in
                Text(verbatim: "\(row.soc)%").monospacedDigit()
            }
            .exportingText { String($0.soc) },
            DataTableColumn(
                key: "odometer",
                header: "Odometer",
                alignment: .trailing,
                visibleOnMobile: false
            ) { row in
                Text(verbatim: "\(row.odometer) mi").monospacedDigit()
            }
            .exportingText { String($0.odometer) }
        ]
    }

    @MainActor
    private func dataTableStaged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 640, alignment: .leading)
        .background(Color.TS.bg)
    }

    /// A controlled host that owns the selection / expansion sets and re-feeds them, mirroring a real call site.
    @MainActor
    private struct DataTablePreviewHost: View {
        let selectionMode: DataTableSelectionMode
        let expandable: Bool
        let exportable: Bool
        @State private var selected: Set<DataTableRowKey> = []
        @State private var expanded: Set<DataTableRowKey> = []

        var body: some View {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                selectionMode: selectionMode,
                selectedKeys: selected,
                onSelectionChange: { selected = $0 },
                bulkActions: selectionMode.isSelectable ? { rows in
                    AnyView(Text(verbatim: "Export \(rows.count)").font(Font.TS.caption))
                } : nil,
                expandable: expandable,
                expandedKeys: expanded,
                onExpandedChange: { expanded = $0 },
                renderExpanded: expandable ? { row in
                    AnyView(Text(verbatim: "VIN •••• \(row.id) · \(row.model)").font(Font.TS.bodySm))
                } : nil,
                exportable: exportable
            )
        }
    }

    #Preview("Populated · base") {
        dataTableStaged("base table — only data + columns + keyExtractor") {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id }
            )
        }
    }

    #Preview("Sortable · SoC descending") {
        dataTableStaged("sortable headers; SoC active descending (web sortKey + ChevronDown)") {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                sortKey: "soc",
                sortDirection: .descending,
                onSort: { _ in }
            )
        }
    }

    #Preview("Multi-select · bulk bar · export") {
        dataTableStaged("multi selection → bulk bar + clear; CSV export (tap a row's checkbox)") {
            DataTablePreviewHost(selectionMode: .multi, expandable: false, exportable: true)
        }
    }

    #Preview("Single select") {
        dataTableStaged("single (radio-style) selection — one row at a time") {
            DataTablePreviewHost(selectionMode: .single, expandable: false, exportable: false)
        }
    }

    #Preview("Expandable rows") {
        dataTableStaged("expand chevron reveals a per-row drawer (web renderExpanded)") {
            DataTablePreviewHost(selectionMode: .none, expandable: true, exportable: false)
        }
    }

    #Preview("Resize · column menu") {
        dataTableStaged("drag a header edge to resize; the Columns menu hides / reorders columns") {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                tableId: "preview:vehicles",
                resizable: true,
                columnVisibility: true,
                columnReorder: true
            )
        }
    }

    #Preview("Paginated") {
        dataTableStaged("pagination — 3 rows per page (web Pagination footer)") {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                pagination: DataTablePagination(defaultPageSize: 3, pageSizeOptions: [3, 6])
            )
        }
    }

    #Preview("Empty") {
        dataTableStaged("no rows → the emptyMessage (web data.length === 0 branch)") {
            DataTable(
                data: [DataTablePreviewVehicle](),
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                emptyMessage: "No vehicles match these filters"
            )
        }
    }

    #Preview("Error · duplicate keys") {
        dataTableStaged("duplicate row keys → the error fallback + retry (web SectionErrorBoundary)") {
            DataTable(
                data: [
                    DataTablePreviewVehicle(id: "dup", name: "Aurora", model: "Model S", soc: 82, odometer: 1),
                    DataTablePreviewVehicle(id: "dup", name: "Comet", model: "Model 3", soc: 47, odometer: 2)
                ],
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id }
            )
        }
    }

    #Preview("Compact density") {
        dataTableStaged("compact density — tight rows (web density='compact')") {
            DataTable(
                data: dataTablePreviewVehicles,
                columns: dataTablePreviewColumns(),
                keyExtractor: { $0.id },
                density: .compact
            )
        }
    }
#endif
