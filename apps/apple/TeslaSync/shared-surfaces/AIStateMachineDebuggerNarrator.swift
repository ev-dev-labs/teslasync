//
//  AIStateMachineDebuggerNarrator.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  The Helix FSM-trace narrator card — the SwiftUI parity of
//  web/src/components/ai/AIStateMachineDebuggerNarrator.tsx. It is
//  `withAiFeature('state-machine-debugger-narrator')` in the web source (a `useAiEnabled` gate;
//  disabled ⇒ the HOC renders `null`); the InnerSection streams from POST /ai/system/fsm/narrate (a
//  `{vehicle_id, from_unix, to_unix}` scope body so the LLM cannot widen it) and renders the shared
//  `AIFeatureCard` (title "Helix FSM narrator", a description, the Narrate-transitions button, the
//  "Helix" badge, and the `emptyHint` shown when no valid scope is in scope) feeding `AiOutputPanel`.
//  This surface reproduces that composition natively, bound through `FSMNarratorModel` (P1/S8); no
//  networking lives here.
//
//  It never replaces the deterministic FSM transition table, state diagram, or FSM health panel
//  rendered by the StateMachineDebugger surface; like the web source it adds an opt-in, read-only
//  narration section alongside the canonical raw view (ADR-015 §I3 baseline intact).
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null). NOT a hidden section:
//                when on but no narration has been generated, the friendly empty output renders.
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + the header scope hint (when no valid scope) + Narrate-transitions
//                button + output panel (empty / no-scope / thinking / prose / error), plus the
//                orthogonal connectivity axis (live / stale / offline) driving the header freshness
//                chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIStateMachineDebuggerNarrator (the shared surface)

/// The Helix FSM-trace narrator card — the SwiftUI parity of `AIStateMachineDebuggerNarrator.tsx`.
/// Renders every state from the web source plus the P4 leaf freshness states, binding through
/// `FSMNarratorModel`.
public struct AIStateMachineDebuggerNarrator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIStateMachineDebuggerNarrator"

    @State private var model: FSMNarratorModel

    public init(model: FSMNarratorModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.isGated {
                // Web `withAiFeature` off → the whole surface is withdrawn.
                EmptyView()
            } else {
                card
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension AIStateMachineDebuggerNarrator {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                FSMNarratorConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: FSMNarratorStrings.string(
                "stateMachineDebugger.aiNarrator.title",
                "Helix FSM narrator"
            ))
        )
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: FSMNarratorStrings.string(
                "stateMachineDebugger.aiNarrator.title",
                "Helix FSM narrator"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
            FSMNarratorHelixBadge(
                label: FSMNarratorStrings.string("stateMachineDebugger.aiNarrator.badge", "Helix")
            )
            Spacer(minLength: TSSpacing.sm)
            FSMNarratorFreshnessChip(connection: model.connection)
            FSMNarratorRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIStateMachineDebuggerNarrator {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            FSMNarratorLoadingView()
        case let .error(message):
            FSMNarratorGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                FSMNarratorReadyView(ready: ready) { model.narrate() }
            }
        }
    }
}
