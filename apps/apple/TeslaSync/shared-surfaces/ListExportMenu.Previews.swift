//
//  ListExportMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0155 · ListExportMenu (Apple)
//
//  Xcode previews for each branch the web source renders: the ready trigger (no selection), the ready
//  trigger with a selection (the scope chooser appears in the popover), the loading trigger (spinner),
//  the empty trigger (dimmed, "No data to export"), and the popover body itself in both the
//  no-selection and with-selection shapes so the menu content reads without a live presentation.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux list-controls strip hosting the trigger in its action area, so it reads in context.
    private struct ListExportMenuPreviewBar<Trailing: View>: View {
        let title: String
        @ViewBuilder let trailing: Trailing

        var body: some View {
            HStack {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer()
                trailing
            }
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .padding()
            .background(Color.TS.bg)
        }
    }

    #Preview("Ready · no selection") {
        ListExportMenuPreviewBar(title: "Drives") {
            ListExportMenu(
                onExportCsv: { _ in },
                onExportJson: { _ in },
                visibleCount: 42
            )
        }
    }

    #Preview("Ready · with selection") {
        ListExportMenuPreviewBar(title: "Charging") {
            ListExportMenu(
                onExportCsv: { _ in },
                onExportJson: { _ in },
                selectedCount: 3,
                visibleCount: 42
            )
        }
    }

    #Preview("Loading") {
        ListExportMenuPreviewBar(title: "Trips") {
            ListExportMenu(
                onExportCsv: { _ in },
                onExportJson: { _ in },
                availability: .loading
            )
        }
    }

    #Preview("Empty (no data to export)") {
        ListExportMenuPreviewBar(title: "Trips") {
            ListExportMenu(
                onExportCsv: { _ in },
                onExportJson: { _ in },
                availability: .empty
            )
        }
    }

    #Preview("Popover · no selection") {
        StatefulPreviewWrapper(ListExportScope.visible) { scope in
            ListExportMenuPopoverContent(
                scope: scope,
                selectedCount: 0,
                visibleCount: 128,
                onExport: { _ in }
            )
            .padding()
            .background(Color.TS.surface)
        }
    }

    #Preview("Popover · with selection") {
        StatefulPreviewWrapper(ListExportScope.selected) { scope in
            ListExportMenuPopoverContent(
                scope: scope,
                selectedCount: 7,
                visibleCount: 128,
                onExport: { _ in }
            )
            .padding()
            .background(Color.TS.surface)
        }
    }

    /// A tiny `@State` host so the popover-content previews can bind a mutable scope (the radio rows
    /// are interactive in the canvas).
    private struct StatefulPreviewWrapper<Value, Content: View>: View {
        @State private var value: Value
        private let content: (Binding<Value>) -> Content

        init(_ initial: Value, @ViewBuilder content: @escaping (Binding<Value>) -> Content) {
            _value = State(initialValue: initial)
            self.content = content
        }

        var body: some View {
            content($value)
        }
    }
#endif
