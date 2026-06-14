//
//  DataTableColumnsMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  Xcode previews for every branch of the column-visibility menu: the full panel (checkboxes, with a required
//  pinned column and a hidden column), the last-visible guardrail (only one column visible — its checkbox is
//  disabled), the friendly empty body, and a fully interactive host whose default "Columns" chip opens the
//  live popover. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
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

    private func columnsMenuSampleColumns() -> [DataTableColumnsMenuColumn] {
        [
            DataTableColumnsMenuColumn(key: "select", header: "", isRequired: true),
            DataTableColumnsMenuColumn(key: "name", header: "Drive"),
            DataTableColumnsMenuColumn(key: "distance", header: "Distance"),
            DataTableColumnsMenuColumn(key: "duration", header: "Duration"),
            DataTableColumnsMenuColumn(key: "energy", header: "Energy used"),
            DataTableColumnsMenuColumn(key: "efficiency", header: "Efficiency"),
            DataTableColumnsMenuColumn(key: "startedAt", header: "Started")
        ]
    }

    @MainActor
    private func columnsMenuSampleController(visibleKeys: [String]? = nil) -> DataTableColumnsMenuController {
        DataTableColumnsMenuController(columns: columnsMenuSampleColumns(), visibleKeys: visibleKeys)
    }

    @MainActor
    private struct DataTableColumnsMenuInteractivePreview: View {
        @State private var controller = DataTableColumnsMenuController(
            columns: [
                DataTableColumnsMenuColumn(key: "select", header: "", isRequired: true),
                DataTableColumnsMenuColumn(key: "name", header: "Drive"),
                DataTableColumnsMenuColumn(key: "distance", header: "Distance"),
                DataTableColumnsMenuColumn(key: "duration", header: "Duration"),
                DataTableColumnsMenuColumn(key: "energy", header: "Energy used")
            ],
            visibleKeys: ["select", "name", "distance"]
        )

        var body: some View {
            VStack(alignment: .trailing, spacing: TSSpacing.md) {
                HStack {
                    Text(verbatim: "Drives")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer()
                    DataTableColumnsMenu(controller: controller)
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

    #Preview("Full panel · show / hide") {
        staged("checkboxes · required 'select' pinned · 'Efficiency' hidden") {
            DataTableColumnsMenuPanel(
                controller: columnsMenuSampleController(
                    visibleKeys: ["select", "name", "distance", "duration", "energy", "startedAt"]
                )
            )
        }
    }

    #Preview("Last-visible guardrail") {
        staged("only one column visible — its checkbox is disabled (can't hide the last)") {
            DataTableColumnsMenuPanel(controller: columnsMenuSampleController(visibleKeys: ["name"]))
        }
    }

    #Preview("Empty body") {
        staged("menu opened with no columns") {
            DataTableColumnsMenuEmptyView()
                .frame(width: DataTableColumnsMenuLayout.popoverWidth, alignment: .leading)
                .tsGlassPanel(cornerRadius: TSRadius.lg)
        }
    }

    #Preview("Interactive host") {
        staged("tap the Columns chip to open the live popover") {
            DataTableColumnsMenuInteractivePreview()
        }
    }
#endif
