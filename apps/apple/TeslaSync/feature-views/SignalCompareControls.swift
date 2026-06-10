//
//  SignalCompareControls.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The signal-diff window / preset / filter controls — the SwiftUI parity of
//  features/telemetry/components/SignalCompareControls.tsx. Fades in on appear (web
//  `FadeIn`) inside a glass panel (web `GlassPanel`), then switches over the bound
//  model's phase so every prompt-required state renders (loading / empty / error /
//  content, with the stale + offline freshness branches inside content) — never a
//  blank box. Binds through `SignalCompareControlsModel` (P1/S8); no networking lives
//  here.
//

import SwiftUI

/// The signal-compare controls — the SwiftUI parity of the web `SignalCompareControls`,
/// binding through `SignalCompareControlsModel` (P1/S8). Pure controls: it edits the
/// host's controlled selection (windows / presets / filter / category) and never
/// fetches a diff itself.
public struct SignalCompareControls: View {
    @State private var model: SignalCompareControlsModel
    private let topSlot: AnyView?

    public init(model: SignalCompareControlsModel) {
        _model = State(initialValue: model)
        topSlot = nil
    }

    /// Variant with a top slot rendered above the windows (web `topSlot` — a vehicle
    /// picker, etc.).
    public init(model: SignalCompareControlsModel, @ViewBuilder topSlot: () -> some View) {
        _model = State(initialValue: model)
        self.topSlot = AnyView(topSlot())
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The top-level branch: loading / failed without a cached context map to skeleton /
    /// retry, no comparable signals resolves to the friendly empty, and otherwise the
    /// controlled compare controls render (with the stale + offline banner + freshness
    /// chip inside).
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            SignalCompareLoadingState()
        case let .error(message):
            SignalCompareErrorState(message: message) { model.refresh() }
        case .empty:
            SignalCompareEmptyState()
        case .content:
            SignalCompareContent(model: model, topSlot: topSlot)
        }
    }
}

// MARK: - Surface identity

public extension SignalCompareControls {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SignalCompareSurface.slug
    }
}
