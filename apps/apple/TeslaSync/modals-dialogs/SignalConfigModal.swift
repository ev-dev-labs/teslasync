//
//  SignalConfigModal.swift
//  TeslaSync — P4 modal / dialog · 0016 · SignalConfigModal (Apple)
//
//  The Fleet Telemetry signal-configuration modal — the SwiftUI parity of
//  components/ui/SignalConfigModal.tsx. The web source is a full-size dialog with a sticky header
//  (title + selection count), sticky master controls (8 presets, select-all, master interval,
//  search), a scrollable category-grouped signal list (per-category + per-signal interval pickers),
//  and a sticky footer (selection summary + Cancel + "Subscribe N Signals"). The native surface
//  reproduces that exactly as an Apple modal: a pinned header + master bar, a scrolling grouped list,
//  and a pinned footer, switching over the model's resolved phase so every prompt-required state
//  renders (loading / empty / error / populated, plus the in-list search-empty + stale / offline
//  freshness) — never a blank box. Binds through `SignalConfigModel` (P1/S8); no networking lives
//  here. Designed to be presented in a `.sheet`; the view owns dismissal, the model owns the
//  subscribe / cancel seams.
//

import SwiftUI

/// The signal-configuration surface, binding through `SignalConfigModel` (P1/S8). Presented in a
/// sheet by a host; the header Close + footer Cancel dismiss (web `onClose`), and Subscribe commits
/// the chosen subscriptions (web `onSubmit`) before dismissing.
public struct SignalConfigModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SignalConfigSurface.slug

    @State private var model: SignalConfigModel
    @Environment(\.dismiss) private var dismiss

    public init(model: SignalConfigModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            SignalConfigHeader(model: model, onClose: cancel)
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

    /// The body under the header: the full config form for `.populated`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: SignalConfigPhase) -> some View {
        switch phase {
        case .loading:
            SignalConfigLoadingState()
        case .empty:
            SignalConfigEmptyState()
        case let .error(message):
            SignalConfigErrorState(message: message) { model.refresh() }
        case .populated:
            SignalConfigPopulatedView(model: model, onCancel: cancel, onSubmit: submit)
        }
    }

    /// Web `onClose` — record the cancel intent, then dismiss the sheet.
    private func cancel() {
        model.cancel()
        dismiss()
    }

    /// Web `handleSubmit` — commit the selected subscriptions, then dismiss the sheet.
    private func submit() {
        model.submit()
        dismiss()
    }
}
