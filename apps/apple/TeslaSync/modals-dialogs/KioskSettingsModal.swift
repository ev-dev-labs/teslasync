//
//  KioskSettingsModal.swift
//  TeslaSync — P4 modal / dialog · 0025 · KioskSettingsModal (Apple)
//
//  The dashboard kiosk-mode settings modal — the SwiftUI parity of
//  features/dashboard/components/KioskSettingsModal.tsx. The web source is a `size="lg"` `Modal` that
//  configures kiosk mode: dashboard auto-rotation (cadence + which dashboards rotate), display
//  behaviours (cursor auto-hide, screen dim, clock), and widget / background transparency with a live
//  preview, then a Cancel / "Enter Kiosk Mode" footer. The native surface reproduces that as an Apple
//  modal — a pinned header, a scrolling grouped form, and a pinned footer — switching over the
//  model's resolved phase so every prompt-required state renders (loading / empty / error / populated,
//  plus the stale / offline freshness envelopes) — never a blank box. Binds through
//  `KioskSettingsModel` (P1/S8); no persistence or networking lives here. Designed to be presented in
//  a `.sheet`; the view owns dismissal, the model owns the persist / enter / cancel seams.
//

import SwiftUI

/// The kiosk-settings surface, binding through `KioskSettingsModel` (P1/S8). Presented in a sheet by
/// a host; the header Close + footer Cancel dismiss (web `onClose`), and Enter commits the rotation
/// selection + enters kiosk mode (web `handleEnter`) before dismissing.
public struct KioskSettingsModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = KioskSettingsSurface.slug

    @State private var model: KioskSettingsModel
    @Environment(\.dismiss) private var dismiss

    public init(model: KioskSettingsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            KioskSettingsHeader(model: model, onClose: cancel)
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
    private func body(for phase: KioskPhase) -> some View {
        switch phase {
        case .loading:
            KioskSettingsLoadingState()
        case .empty:
            KioskSettingsEmptyState()
        case let .error(message):
            KioskSettingsErrorState(message: message) { model.refresh() }
        case .populated:
            KioskSettingsPopulatedView(model: model, onCancel: cancel, onEnter: enter)
        }
    }

    /// Web `onClose` — record the cancel intent, then dismiss the sheet.
    private func cancel() {
        model.cancel()
        dismiss()
    }

    /// Web `handleEnter` — commit the selection + enter kiosk mode, then dismiss the sheet.
    private func enter() {
        model.enter()
        dismiss()
    }
}
