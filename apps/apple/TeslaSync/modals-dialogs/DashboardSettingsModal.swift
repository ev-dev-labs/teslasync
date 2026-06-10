//
//  DashboardSettingsModal.swift
//  TeslaSync — P4 modal / dialog · 0022 · DashboardSettingsModal (Apple)
//
//  The dashboard-settings modal — the SwiftUI parity of
//  features/dashboard/components/DashboardSettingsModal.tsx. The web source is a medium dialog with a
//  header (title + close) and a scrolling form of four sections — Identity (name + 16-emoji icon
//  grid), Vehicle Filter (scope select), Auto-Refresh (cadence select), and Display (two toggles) —
//  over a pinned footer (Cancel + Save). The native surface reproduces that exactly as an Apple modal:
//  a pinned header, a scrolling sectioned form, and a pinned footer, switching over the model's
//  resolved phase so every prompt-required state renders (loading / empty / error / populated, plus
//  the stale / offline freshness on the fleet vehicle list) — never a blank box. Binds through
//  `DashboardSettingsModel` (P1/S8); no networking lives here. Designed to be presented in a `.sheet`;
//  the view owns dismissal, the model owns the save / cancel seams.
//

import SwiftUI

/// The dashboard-settings surface, binding through `DashboardSettingsModel` (P1/S8). Presented in a
/// sheet by a host; the header Close + footer Cancel dismiss (web `onClose`), and Save commits the
/// rename / icon / settings deltas (web `handleSave`) before dismissing.
public struct DashboardSettingsModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DashboardSettingsSurface.slug

    @State private var model: DashboardSettingsModel
    @Environment(\.dismiss) private var dismiss

    public init(model: DashboardSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            DashboardSettingsHeader(model: model, onClose: cancel)
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
    private func body(for phase: DashboardSettingsPhase) -> some View {
        switch phase {
        case .loading:
            DashboardSettingsLoadingState()
        case .empty:
            DashboardSettingsEmptyState()
        case let .error(message):
            DashboardSettingsErrorState(message: message) { model.refresh() }
        case .populated:
            DashboardSettingsPopulatedView(model: model, onCancel: cancel, onSave: save)
        }
    }

    /// Web `onClose` — record the cancel intent, then dismiss the sheet.
    private func cancel() {
        model.cancel()
        dismiss()
    }

    /// Web `handleSave` — commit the rename / icon / settings deltas, then dismiss the sheet.
    private func save() {
        model.save()
        dismiss()
    }
}
