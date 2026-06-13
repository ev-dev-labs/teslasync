//
//  DataTableColumnMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  Xcode previews for every branch of the column visibility + reorder menu: the full panel (checkboxes +
//  ↑ / ↓ reorder, with a required pinned column, a hidden-by-default column, and the last-visible
//  guardrail), the visibility-only checklist (reorder off, the legacy `showColumnsMenu` parity), the
//  reorder-only list (checkboxes off), the friendly empty body, and a fully interactive host whose default
//  "Columns" chip opens the live popover. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func dataTableSampleColumns() -> [ColumnDescriptor] {
        [
            ColumnDescriptor(key: "select", header: "", isRequired: true),
            ColumnDescriptor(key: "name", header: "Drive"),
            ColumnDescriptor(key: "distance", header: "Distance"),
            ColumnDescriptor(key: "duration", header: "Duration"),
            ColumnDescriptor(key: "energy", header: "Energy used"),
            ColumnDescriptor(key: "efficiency", header: "Efficiency", defaultVisible: false),
            ColumnDescriptor(key: "startedAt", header: "Started")
        ]
    }

    @MainActor
    private func dataTableSampleController(
        reorderable: Bool = true,
        toggleable: Bool = true,
        layout: ColumnLayout? = nil
    ) -> DataTableColumnMenuController {
        DataTableColumnMenuController(
            columns: dataTableSampleColumns(),
            layout: layout,
            reorderable: reorderable,
            toggleable: toggleable
        )
    }

    @MainActor
    private struct DataTableColumnMenuInteractivePreview: View {
        @State private var controller = DataTableColumnMenuController(columns: [
            ColumnDescriptor(key: "select", header: "", isRequired: true),
            ColumnDescriptor(key: "name", header: "Drive"),
            ColumnDescriptor(key: "distance", header: "Distance"),
            ColumnDescriptor(key: "duration", header: "Duration"),
            ColumnDescriptor(key: "energy", header: "Energy used")
        ])

        var body: some View {
            VStack(alignment: .trailing, spacing: TSSpacing.md) {
                HStack {
                    Text(verbatim: "Drives")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer()
                    DataTableColumnMenu(controller: controller)
                }
                Text(verbatim: "Visible: \(controller.visibleColumns.map(\.displayLabel).joined(separator: " · "))")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(TSSpacing.lg)
            .tsGlassPanel()
        }
    }

    #Preview("Full panel · toggle + reorder") {
        staged("checkboxes + ↑ / ↓ · required 'select' pinned · 'Efficiency' hidden by default") {
            DataTableColumnMenuPanel(controller: dataTableSampleController())
        }
    }

    #Preview("Last-visible guardrail") {
        staged("only one column visible — its checkbox is disabled (can't hide the last)") {
            DataTableColumnMenuPanel(
                controller: dataTableSampleController(
                    layout: ColumnLayout(
                        order: ["select", "name", "distance", "duration", "energy", "efficiency", "startedAt"],
                        hidden: ["select", "distance", "duration", "energy", "efficiency", "startedAt"]
                    )
                )
            )
        }
    }

    #Preview("Visibility-only checklist") {
        staged("reorder off — pure show / hide (legacy showColumnsMenu parity)") {
            DataTableColumnMenuPanel(controller: dataTableSampleController(reorderable: false))
        }
    }

    #Preview("Reorder-only list") {
        staged("checkboxes off — pure reorder") {
            DataTableColumnMenuPanel(controller: dataTableSampleController(toggleable: false))
        }
    }

    #Preview("Empty body") {
        staged("menu opened with no columns") {
            DataTableColumnMenuEmptyView()
                .frame(width: DataTableColumnMenuLayout.popoverWidth, alignment: .leading)
                .tsGlassPanel(cornerRadius: TSRadius.lg)
        }
    }

    #Preview("Interactive host") {
        staged("tap the Columns chip to open the live popover") {
            DataTableColumnMenuInteractivePreview()
        }
    }
#endif
