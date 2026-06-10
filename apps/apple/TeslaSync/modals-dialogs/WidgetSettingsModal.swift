//
//  WidgetSettingsModal.swift
//  TeslaSync — P4 modal / dialog · 0027 · WidgetSettingsModal (Apple)
//
//  The widget-settings modal — the SwiftUI parity of
//  features/dashboard/components/WidgetSettingsModal.tsx. The web source is a small dialog with a
//  header (`${def.name} Settings` + close) and a short form of up to four sections — Vehicle (shown
//  only for vehicle widgets), Refresh Interval, Time Range (shown only for chart widgets), and
//  Appearance (the show-title switch) — over a footer (Cancel + Save). The native surface reproduces
//  that exactly as an Apple modal: a pinned header, a scrolling sectioned form, and a pinned footer,
//  switching over the model's resolved phase so every prompt-required state renders (loading / empty /
//  error / populated, plus the stale / offline freshness on the fleet vehicle list) — never a blank
//  box. Binds through `WidgetSettingsModel` (P1/S8); no networking lives here. Designed to be presented
//  in a `.sheet`; the view owns dismissal, the model owns the save / cancel seams.
//

import SwiftUI

/// The widget-settings surface, binding through `WidgetSettingsModel` (P1/S8). Presented in a sheet by
/// a host; the header Close + footer Cancel dismiss (web `onClose`), and Save commits the edited config
/// (web `handleSave` → `onSave(config)`) before dismissing.
public struct WidgetSettingsModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetSettingsSurface.slug

    @State private var model: WidgetSettingsModel
    @Environment(\.dismiss) private var dismiss

    public init(model: WidgetSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            WidgetSettingsHeader(model: model, onClose: cancel)
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

    /// The body under the header: the full settings form for `.populated`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: WidgetSettingsPhase) -> some View {
        switch phase {
        case .loading:
            WidgetSettingsLoadingState()
        case .empty:
            WidgetSettingsEmptyState()
        case let .error(message):
            WidgetSettingsErrorState(message: message) { model.refresh() }
        case .populated:
            WidgetSettingsPopulatedView(model: model, onCancel: cancel, onSave: save)
        }
    }

    /// Web `onClose` — record the cancel intent, then dismiss the sheet.
    private func cancel() {
        model.cancel()
        dismiss()
    }

    /// Web `handleSave` — commit the edited config, then dismiss the sheet.
    private func save() {
        model.save()
        dismiss()
    }
}
