//
//  AISafetySettingExplainer.Projection.swift
//  TeslaSync — P4 shared surface · 0045 · AISafetySettingExplainer (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Ask-Helix button, the `canStart = state !== 'paused-confirm'` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AISafetySettingExplainer` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum SafetySettingExplainerProjection {
    public static func resolve(
        _ input: SafetySettingExplainerInput,
        locale: Locale = .current
    ) -> SafetySettingExplainerResolved {
        switch input.availability {
        case .loading:
            return SafetySettingExplainerResolved(phase: .loading)
        case let .failed(message):
            return SafetySettingExplainerResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return SafetySettingExplainerResolved(phase: .gated) }
            return SafetySettingExplainerResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: SafetySettingExplainerInput, locale _: Locale) -> SafetySettingExplainerReady {
        // Web `canStart={stream.state !== 'paused-confirm'}` — no vehicle/input gate (empty body).
        let action = SafetySettingExplainerAction.derive(state: input.stream.state)

        let buttonContext = SafetySettingExplainerStrings.string(
            "safetySettings.aiExplainer.button",
            "Explain my settings"
        )
        let askHelix = SafetySettingExplainerStrings.string("helix.askHelix", "Ask Helix")
        let thinking = SafetySettingExplainerStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return SafetySettingExplainerReady(
            title: SafetySettingExplainerStrings.string(
                "safetySettings.aiExplainer.title",
                "Explain my safety settings"
            ),
            description: SafetySettingExplainerStrings.string(
                "safetySettings.aiExplainer.description",
                "Ask Helix to explain the safety-related TeslaSync settings on this page in plain "
                    + "English. Helix only reads the typed envelope of canonical setting values "
                    + "(booleans, enum strings, HH:MM times) \u{2014} it never reads notification "
                    + "titles, vehicle names, or any other PII, and it never proposes or changes a "
                    + "setting. Use the controls below to update a value yourself; Helix only narrates."
            ),
            badge: SafetySettingExplainerStrings.string("safetySettings.aiExplainer.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: SafetySettingExplainerAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: action.canStart,
            action: action,
            output: output(for: input.stream)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `SafetySettingExplainerOutputKind` into the view-ready output. The
    /// friendly empty hint keeps the P4 "never a blank box" rule. Unlike the vehicle-gated cards
    /// there is no no-input branch (the web body is empty), so the empty state is a single hint.
    private static func output(
        for snapshot: SafetySettingExplainerStreamSnapshot
    ) -> SafetySettingExplainerResolvedOutput {
        let title = SafetySettingExplainerStrings.string(
            "safetySettings.aiExplainer.output.a11yTitle",
            "Safety-setting explanation"
        )
        switch SafetySettingExplainerOutput.derive(snapshot) {
        case .empty:
            let hint = SafetySettingExplainerStrings.string(
                "safetySettings.aiExplainer.output.emptyHint",
                "No explanation yet \u{2014} ask Helix to explain your safety settings."
            )
            return SafetySettingExplainerResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = SafetySettingExplainerStrings.string("helix.thinking", "Helix is thinking…")
            return SafetySettingExplainerResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return SafetySettingExplainerResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: SafetySettingExplainerAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = SafetySettingExplainerStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? SafetySettingExplainerStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return SafetySettingExplainerResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
