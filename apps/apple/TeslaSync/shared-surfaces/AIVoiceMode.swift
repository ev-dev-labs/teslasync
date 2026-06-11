//
//  AIVoiceMode.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The Helix voice-mode panel — the SwiftUI parity of web/src/components/ai/AIVoiceMode.tsx. It is
//  `withAiFeature('voice-mode')` in the web source (a `useAiEnabled` gate; disabled ⇒ the HOC
//  renders `null`); the inner panel streams from POST /ai/voice/chat (body `{ message, session_id }`)
//  and renders the shared `AIFeatureCard` (title "Voice mode", a privacy-forward description, the
//  optional "Tap the mic and dictate a question first." empty hint, the universal Ask-Helix button
//  labelled "Speak to Helix", the "Helix" badge) with a voice input slot — the live transcript box
//  plus the mic / mute / stop controls — feeding `AiOutputPanel`. This surface reproduces that
//  composition natively, bound through `VoiceModeModel` (P1/S8); no networking and no speech engine
//  live here.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated   — feature off → renders nothing (web `withAiFeature` → null).
//    • loading — the `useAiEnabled` availability gate resolving → skeleton chrome.
//    • error   — the availability query failed → a retryable gate-error; a terminal STREAM error
//                renders inline as "Helix error: {message}" in the output panel.
//    • ready   — the description + optional empty hint + the voice input slot (transcript box + mic /
//                mute / stop) + Ask-Helix button + output panel (empty / thinking / prose / error),
//                plus the orthogonal connectivity axis (live / stale / offline) driving the header
//                freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIVoiceMode (the shared surface)

/// The Helix voice-mode card — the SwiftUI parity of `AIVoiceMode.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through `VoiceModeModel`.
public struct AIVoiceMode: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIVoiceMode"

    @State private var model: VoiceModeModel

    public init(model: VoiceModeModel) {
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

private extension AIVoiceMode {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                VoiceModeConnectivityBanner(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: VoiceModeStrings.string("voiceMode.title", "Voice mode")))
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: VoiceModeStrings.string("voiceMode.title", "Voice mode"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            VoiceModeHelixBadge(label: VoiceModeStrings.string("voiceMode.badge", "Helix"))
            Spacer(minLength: TSSpacing.sm)
            VoiceModeFreshnessChip(connection: model.connection)
            VoiceModeRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AIVoiceMode {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            VoiceModeLoadingView()
        case let .error(message):
            VoiceModeGateErrorView(message: message) { model.refresh() }
        case .ready:
            if let ready = model.ready {
                VoiceModeReadyView(
                    ready: ready,
                    onSpeak: { model.handleAction() },
                    onToggleMic: { model.toggleListening() },
                    onToggleTts: { model.toggleTts() },
                    onStopAll: { model.handleStopAll() }
                )
            }
        }
    }
}
