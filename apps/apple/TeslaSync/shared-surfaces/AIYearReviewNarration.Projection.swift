//
//  AIYearReviewNarration.Projection.swift
//  TeslaSync — P4 shared surface · 0061 · AIYearReviewNarration (Apple)
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
/// `AIYearReviewNarration` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum YearReviewNarrationProjection {
    public static func resolve(
        _ input: YearReviewNarrationInput,
        locale: Locale = .current
    ) -> YearReviewNarrationResolved {
        switch input.availability {
        case .loading:
            return YearReviewNarrationResolved(phase: .loading)
        case let .failed(message):
            return YearReviewNarrationResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return YearReviewNarrationResolved(phase: .gated) }
            return YearReviewNarrationResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: YearReviewNarrationInput,
        locale _: Locale
    ) -> YearReviewNarrationReady {
        // Web `canStart={vehicleId != null}`: the narration call needs a present vehicle id; the body
        // coalesces a missing id to 0 (`vehicleId ?? 0`), but the button stays disabled until a
        // vehicle is in scope. `vehicleId == 0` is a valid present id (`0 != null`) and passes.
        let canStart = (input.vehicleID != nil)
        let action = YearReviewNarrationAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = YearReviewNarrationStrings.string(
            "yearReview.aiNarration.generateButton",
            "Generate narration"
        )
        let askHelix = YearReviewNarrationStrings.string("helix.askHelix", "Ask Helix")
        let thinking = YearReviewNarrationStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return YearReviewNarrationReady(
            title: YearReviewNarrationStrings.string(
                "yearReview.aiNarration.title",
                "Helix narration"
            ),
            description: YearReviewNarrationStrings.string(
                "yearReview.aiNarration.description",
                "Get a short, Helix-written recap of your year from the slide data above."
            ),
            badge: YearReviewNarrationStrings.string("yearReview.aiNarration.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: YearReviewNarrationAccessibility.actionLabel(
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
        for snapshot: YearReviewNarrationStreamSnapshot,
        canStart: Bool
    ) -> YearReviewNarrationResolvedOutput {
        let title = YearReviewNarrationStrings.string(
            "yearReview.aiNarration.output.a11yTitle",
            "Helix narration"
        )
        switch YearReviewNarrationOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? YearReviewNarrationStrings.string(
                    "yearReview.aiNarration.output.emptyHint",
                    "No narration yet — ask Helix to recap your year from the slides above."
                )
                : YearReviewNarrationStrings.string(
                    "yearReview.aiNarration.output.noVehicleHint",
                    "Pick a vehicle to ask Helix for a year-in-review narration."
                )
            return YearReviewNarrationResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = YearReviewNarrationStrings.string("helix.thinking", "Helix is thinking…")
            return YearReviewNarrationResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return YearReviewNarrationResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: YearReviewNarrationAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = YearReviewNarrationStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? YearReviewNarrationStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return YearReviewNarrationResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
