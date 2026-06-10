//
//  WidgetCatalogueDialog.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The widget-catalogue dialog — the SwiftUI parity of
//  features/dashboard/components/WidgetCatalogueDialog.tsx. The web source is a full-screen modal
//  (`Modal size="full"`) with a header (title + close), a subtitle + a search field, and a scrolling list
//  of category sections; each section lists its widgets (icon + name + description), badges the ones
//  already on the dashboard ("Added"), and offers an Add button that inserts the widget then closes the
//  dialog. The native surface reproduces that exactly as an Apple modal: a pinned header, a scrolling
//  catalogue, and a sticky search field, switching over the model's resolved phase so every
//  prompt-required state renders (loading / empty / error / populated, plus the stale / offline freshness
//  on the active-widget set, plus the in-catalogue no-matches empty state) — never a blank box. Binds
//  through `WidgetCatalogueModel` (P1/S8); no networking lives here. Designed to be presented in a
//  `.sheet`; the view owns dismissal, the model owns the add / close seams.
//

import SwiftUI

/// The widget-catalogue surface, binding through `WidgetCatalogueModel` (P1/S8). Presented in a sheet by
/// a host; the header Close (web `onClose`) dismisses, and picking a widget commits the add (web
/// `onAdd`) before dismissing.
public struct WidgetCatalogueDialog: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetCatalogueSurface.slug

    @State private var model: WidgetCatalogueModel
    @Environment(\.dismiss) private var dismiss

    public init(model: WidgetCatalogueModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            WidgetCatalogueHeader(model: model, onClose: closeDialog)
            Divider().overlay(Color.TS.border)
            body(for: model.phase)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// The body under the header: the full catalogue for `.populated`, else the loading / empty / error
    /// envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: WidgetCataloguePhase) -> some View {
        switch phase {
        case .loading:
            WidgetCatalogueLoadingState()
        case .empty:
            WidgetCatalogueEmptyState()
        case let .error(message):
            WidgetCatalogueErrorState(message: message) { model.refresh() }
        case .populated:
            WidgetCataloguePopulatedView(model: model, onAdd: addWidget)
        }
    }

    /// Web `onClose` — record the close intent, then dismiss the sheet.
    private func closeDialog() {
        model.close()
        dismiss()
    }

    /// Web `handleAdd` — commit the add (a no-op for an already-added widget) then dismiss the sheet, so
    /// the catalogue closes after a successful pick (web `onAdd` then `onClose`).
    private func addWidget(_ id: String) {
        guard model.add(id) else { return }
        dismiss()
    }
}
