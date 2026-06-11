//
//  AIVoiceMode.Projection.swift
//  TeslaSync — P4 shared surface · 0059 · AIVoiceMode (Apple)
//
//  The pure projection from the coalesced input snapshot (source feed + local dictation state) to
//  the resolved view-state — extracted from the coordinator so the web component body (the
//  `withAiFeature` gate, the `AIFeatureCard` header / description / Ask-Helix button, the
//  `canStart = transcript.trim() > 0 && !busy` rule, the `emptyHint` header hint, the voice input
//  slot — transcript box + mic / TTS / stop controls + dictation error + unsupported hint — and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI, no speech engine). Localization is applied here (P1/S10) so the view is a pure function
//  of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from `(VoiceModeInput, VoiceModeUIState)` to the resolved view-state — the native
/// port of the web `AIVoiceMode` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the header empty-hint flip,
/// the Ask-Helix label flip, every input-slot control, and every `AiOutputPanel` branch.
public enum VoiceModeProjection {
    public static func resolve(
        input: VoiceModeInput,
        ui: VoiceModeUIState,
        locale: Locale = .current
    ) -> VoiceModeResolved {
        switch input.availability {
        case .loading:
            return VoiceModeResolved(phase: .loading)
        case let .failed(message):
            return VoiceModeResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return VoiceModeResolved(phase: .gated) }
            return VoiceModeResolved(phase: .ready, ready: ready(input: input, ui: ui, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + input slot + derived button + output)

    private static func ready(
        input: VoiceModeInput,
        ui: VoiceModeUIState,
        locale _: Locale
    ) -> VoiceModeReady {
        let trimmed = ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasTranscript = !trimmed.isEmpty
        let isBusy = input.stream.isBusy
        let canStart = hasTranscript && !isBusy
        let action = VoiceModeAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = VoiceModeStrings.string("voiceMode.button", "Speak to Helix")
        let askHelix = VoiceModeStrings.string("helix.askHelix", "Ask Helix")
        let thinking = VoiceModeStrings.string("helix.thinking", "Helix is thinking\u{2026}")

        return VoiceModeReady(
            title: VoiceModeStrings.string("voiceMode.title", "Voice mode"),
            description: VoiceModeStrings.string("voiceMode.description", Self.descriptionFallback),
            badge: VoiceModeStrings.string("voiceMode.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: action.isStreaming ? thinking : askHelix,
            actionAccessibilityLabel: VoiceModeAccessibility.actionLabel(ask: askHelix, context: buttonContext),
            canStart: canStart,
            emptyHint: hasTranscript ? nil : VoiceModeStrings.string(
                "voiceMode.emptyHint",
                "Tap the mic and dictate a question first."
            ),
            action: action,
            transcript: transcriptView(ui: ui),
            mic: micControl(ui: ui, isBusy: isBusy),
            tts: ttsControl(ui: ui),
            stop: isBusy ? stopControl() : nil,
            sttError: ui.sttError,
            unsupportedHint: unsupportedHint(ui: ui),
            output: output(for: input.stream, hasTranscript: hasTranscript)
        )
    }

    // MARK: Transcript box (web aria-live transcript region)

    private static func transcriptView(ui: VoiceModeUIState) -> VoiceModeTranscriptView {
        let label = VoiceModeStrings.string("voiceMode.transcriptLabel", "Voice transcript")
        let trimmed = ui.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            return VoiceModeTranscriptView(
                display: ui.transcript,
                isHint: false,
                accessibilityLabel: "\(label): \(ui.transcript)"
            )
        }
        let hint = ui.listening
            ? VoiceModeStrings.string("voiceMode.listeningHint", "Listening \u{2014} speak now\u{2026}")
            : VoiceModeStrings.string("voiceMode.idleHint", "Tap the mic and ask Helix anything about your Tesla.")
        return VoiceModeTranscriptView(display: hint, isHint: true, accessibilityLabel: "\(label): \(hint)")
    }

    // MARK: Mic / TTS / stop controls (web input-slot buttons)

    private static func micControl(ui: VoiceModeUIState, isBusy: Bool) -> VoiceModeMicControl {
        if ui.listening {
            return VoiceModeMicControl(
                isListening: true,
                title: VoiceModeStrings.string("voiceMode.actions.stopListeningShort", "Stop mic"),
                accessibilityLabel: VoiceModeStrings.string("voiceMode.actions.stopListening", "Stop listening"),
                isDisabled: false
            )
        }
        return VoiceModeMicControl(
            isListening: false,
            title: VoiceModeStrings.string("voiceMode.actions.startListeningShort", "Speak"),
            accessibilityLabel: VoiceModeStrings.string("voiceMode.actions.startListening", "Start listening"),
            isDisabled: !ui.speechSupported || isBusy
        )
    }

    private static func ttsControl(ui: VoiceModeUIState) -> VoiceModeTtsControl {
        VoiceModeTtsControl(
            isEnabled: ui.ttsEnabled,
            title: ui.ttsEnabled
                ? VoiceModeStrings.string("voiceMode.actions.muteTtsShort", "Mute Helix")
                : VoiceModeStrings.string("voiceMode.actions.unmuteTtsShort", "Unmute Helix"),
            accessibilityLabel: ui.ttsEnabled
                ? VoiceModeStrings.string("voiceMode.actions.muteTts", "Mute spoken replies")
                : VoiceModeStrings.string("voiceMode.actions.unmuteTts", "Unmute spoken replies")
        )
    }

    private static func stopControl() -> VoiceModeStopControl {
        VoiceModeStopControl(
            title: VoiceModeStrings.string("voiceMode.actions.stopAllShort", "Stop"),
            accessibilityLabel: VoiceModeStrings.string("voiceMode.actions.stopAll", "Stop Helix")
        )
    }

    private static func unsupportedHint(ui: VoiceModeUIState) -> String? {
        guard !ui.speechSupported, ui.sttError == nil else { return nil }
        return VoiceModeStrings.string(
            "voiceMode.unsupportedHint",
            "Voice input isn\u{2019}t available on this device. You can still type your question into the chatbot."
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `VoiceModeOutputKind` into the view-ready output. The friendly empty
    /// hint distinguishes the no-transcript case from the dictated-but-not-sent case, keeping the P4
    /// "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: VoiceModeStreamSnapshot,
        hasTranscript: Bool
    ) -> VoiceModeResolvedOutput {
        let title = VoiceModeStrings.string("voiceMode.output.a11yTitle", "Helix voice reply")
        switch VoiceModeOutput.derive(snapshot) {
        case .empty:
            let hint = hasTranscript
                ? VoiceModeStrings.string(
                    "voiceMode.output.emptyHint",
                    "No reply yet \u{2014} tap Speak to Helix to hear the answer read aloud."
                )
                : VoiceModeStrings.string(
                    "voiceMode.output.noTranscriptHint",
                    "Dictate or type a question, then tap Speak to Helix."
                )
            return VoiceModeResolvedOutput(kind: .empty, body: hint, accessibilityLabel: hint)
        case .thinking:
            let label = VoiceModeStrings.string("helix.thinking", "Helix is thinking\u{2026}")
            return VoiceModeResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return VoiceModeResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: VoiceModeAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = VoiceModeStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? VoiceModeStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return VoiceModeResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }

    private static let descriptionFallback =
        "Speak to Helix and hear the reply out loud. Voice input and playback both stay on this "
            + "device \u{2014} only the transcribed text is sent to the assistant, never the raw audio."
}
