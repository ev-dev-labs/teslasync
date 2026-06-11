//
//  SavedViewMenu.Popover.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The popover body composed by `SavedViewMenu` — the native parity of the web `role="menu"` popover:
//  a header (the "Saved views" title + the "Manage views" button when there are views), a phase-driven
//  body (the loading skeleton rows / the error tile with retry / the friendly empty state with a save
//  action / the scrollable saved-view rows), and a footer ("Save current view…"). Binds through the
//  model; every affordance routes to a model method, so no networking lives here.
//

import SwiftUI

// MARK: - Popover content (web popover `role="menu"`)

/// The popover content — header, phase-driven body, footer — bound through `SavedViewMenuModel`.
struct SavedViewMenuPopoverContent: View {
    @Bindable var model: SavedViewMenuModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            phaseBody
            Divider().overlay(Color.TS.border)
            footer
        }
        .padding(TSSpacing.md)
        .frame(minWidth: 288, maxWidth: 360, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.resolved.menuTitle))
    }

    // MARK: Header (web title + Manage)

    private var header: some View {
        HStack {
            Text(verbatim: model.resolved.menuTitle)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            Spacer()
            if model.resolved.hasViews {
                Button { model.presentManage() } label: {
                    Text(verbatim: model.resolved.manageLabel)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("saved-view-manage")
            }
        }
    }

    // MARK: Phase body (P4 leaf contract)

    @ViewBuilder
    private var phaseBody: some View {
        switch model.resolved.phase {
        case .loading:
            SavedViewMenuLoadingRows()
        case let .error(message):
            SavedViewMenuErrorView(message: message) { model.refresh() }
        case .empty:
            SavedViewMenuEmptyView(
                message: model.resolved.emptyMessage,
                saveLabel: model.resolved.saveCurrentLabel
            ) { model.presentSaveDialog() }
        case .loaded:
            rowsList
        }
    }

    private var rowsList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(model.resolved.rows) { row in
                    SavedViewMenuRow(
                        row: row,
                        onApply: { model.apply(row) },
                        onToggleDefault: { Task { await model.toggleDefault(row) } },
                        onTogglePin: { Task { await model.togglePin(row) } },
                        onRename: { model.presentRename(row) },
                        onDelete: { model.requestDelete(row) }
                    )
                }
            }
        }
        .frame(maxHeight: 320)
    }

    // MARK: Footer (web "Save current view…")

    private var footer: some View {
        Button { model.presentSaveDialog() } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: model.resolved.saveCurrentLabel)
                    .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.resolved.saveCurrentLabel))
        .accessibilityIdentifier("saved-view-save-current")
    }
}
