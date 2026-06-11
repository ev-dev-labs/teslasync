//
//  AIDigestNarration.Projection.swift
//  TeslaSync — P4 shared surface · 0016 · AIDigestNarration (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = vehicleId != null` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIDigestNarration` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum DigestNarrationProjection {
    public static func resolve(
        _ input: DigestNarrationInput,
        locale: Locale = .current
    ) -> DigestNarrationResolved {
        switch input.availability {
        case .loading:
            return DigestNarrationResolved(phase: .loading)
        case let .failed(message):
            return DigestNarrationResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return DigestNarrationResolved(phase: .gated) }
            return DigestNarrationResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: DigestNarrationInput,
        locale _: Locale
    ) -> DigestNarrationReady {
        // Web `canStart={vehicleId != null}`: the narration call needs a present vehicle id; the body
        // coalesces a missing id to 0 (`vehicleId ?? 0`), but the button stays disabled until a
        // vehicle is in scope. `vehicleId == 0` is a valid present id (`0 != null`) and passes.
        let canStart = (input.vehicleID != nil)
        let action = DigestNarrationAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = DigestNarrationStrings.string(
            "analytics.weeklyDigest.aiNarration.generateButton",
            "Generate narration"
        )
        let askHelix = DigestNarrationStrings.string("helix.askHelix", "Ask Helix")
        let thinking = DigestNarrationStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return DigestNarrationReady(
            title: DigestNarrationStrings.string(
                "analytics.weeklyDigest.aiNarration.title",
                "Helix narration"
            ),
            description: DigestNarrationStrings.string(
                "analytics.weeklyDigest.aiNarration.description",
                "Get a short, Helix-written recap of your week from the digest data above."
            ),
            badge: DigestNarrationStrings.string("analytics.weeklyDigest.aiNarration.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: DigestNarrationAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural output kind into the view-ready output. The friendly empty hint
    /// distinguishes the no-vehicle case (web button disabled) from the started-but-idle case,
    /// keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: DigestNarrationStreamSnapshot,
        canStart: Bool
    ) -> DigestNarrationResolvedOutput {
        let title = DigestNarrationStrings.string(
            "analytics.weeklyDigest.aiNarration.output.a11yTitle",
            "Helix narration"
        )
        switch DigestNarrationOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? DigestNarrationStrings.string(
                    "analytics.weeklyDigest.aiNarration.output.emptyHint",
                    "No narration yet — ask Helix to recap your week from the digest above."
                )
                : DigestNarrationStrings.string(
                    "analytics.weeklyDigest.aiNarration.output.noVehicleHint",
                    "Pick a vehicle to ask Helix for a weekly-digest narration."
                )
            return DigestNarrationResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = DigestNarrationStrings.string("helix.thinking", "Helix is thinking…")
            return DigestNarrationResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return DigestNarrationResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: DigestNarrationAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = DigestNarrationStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? DigestNarrationStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return DigestNarrationResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
