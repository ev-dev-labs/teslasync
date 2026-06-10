//
//  SignalSelector.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  The composable signal multi-select — the SwiftUI parity of
//  features/telemetry/components/SignalSelector.tsx. The uppercase muted
//  "Signals (N / max)" label + the optional layer-help tooltip, and the capped
//  `TSComboboxMulti` field beneath it, bound through `SignalSelectorModel`
//  (P1/S8). No networking lives here; the label is pure projection (web `${t(
//  'Signals')} (${value.length} / ${max})`), the cap is enforced on write-back
//  (web `slice(0, cap)`), and the candidate-list load status drives the loading /
//  empty / error / stale / offline chrome layered under the always-present field.
//  P1/S11 `view.opened` telemetry fires once on appear with slug "SignalSelector".
//

import SwiftUI

/// The composable signal multi-select — the SwiftUI parity of
/// `features/telemetry/components/SignalSelector.tsx`. Renders the label + field
/// in every state, never hiding the selector behind a null value, and surfaces
/// freshness (stale/offline) + the candidate list's loading/empty/error chrome
/// around it. The view binds through `SignalSelectorModel`; no networking lives here.
public struct SignalSelector: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SignalSelector"

    @State private var model: SignalSelectorModel

    public init(model: SignalSelectorModel) {
        _model = State(initialValue: model)
    }

    /// The freshness banner shows only when the bound source is not live (a cached
    /// signal list is on screen to caption).
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }

    /// Cap-enforcing bridge between the `TSComboboxMulti` `Set` selection and the
    /// model's ordered, capped selection (web `value` + `slice(0, cap)`).
    private var comboSelection: Binding<Set<String>> {
        Binding(
            get: { Set(model.selection) },
            set: { model.setSelection(from: $0) }
        )
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if showsConnectivityBanner {
                    SignalSelectorConnectivityBanner(connection: model.connection)
                }
                SignalSelectorLabelRow(label: model.label, showsLayerHelp: model.showsLayerHelp)
                SignalSelectorComboField(
                    options: model.options,
                    selection: comboSelection,
                    accessibilityLabel: model.selectorSummary
                )
                SignalSelectorStatusLine(phase: model.phase) { model.refresh() }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}
