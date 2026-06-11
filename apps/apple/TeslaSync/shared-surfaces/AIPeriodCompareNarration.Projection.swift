//
//  AIPeriodCompareNarration.Projection.swift
//  TeslaSync — P4 shared surface · 0037 · AIPeriodCompareNarration (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = isFinite(vehicleId) && vehicleId > 0`
//  rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation
//  (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of
//  the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIPeriodCompareNarration` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum PeriodCompareNarrationProjection {
    public static func resolve(
        _ input: PeriodCompareNarrationInput,
        locale: Locale = .current
    ) -> PeriodCompareNarrationResolved {
        switch input.availability {
        case .loading:
            return PeriodCompareNarrationResolved(phase: .loading)
        case let .failed(message):
            return PeriodCompareNarrationResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return PeriodCompareNarrationResolved(phase: .gated) }
            return PeriodCompareNarrationResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: PeriodCompareNarrationInput,
        locale _: Locale
    ) -> PeriodCompareNarrationReady {
        // Web `haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0`.
        let canStart = PeriodCompareNarrationVehicleID.canStart(input.vehicleID)
        let action = PeriodCompareNarrationAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = PeriodCompareNarrationStrings.string(
            "compare.aiNarrative.generateButton",
            "Narrate comparison"
        )
        let askHelix = PeriodCompareNarrationStrings.string("helix.askHelix", "Ask Helix")
        let thinking = PeriodCompareNarrationStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return PeriodCompareNarrationReady(
            title: PeriodCompareNarrationStrings.string(
                "compare.aiNarrative.title",
                "Narrate the period comparison"
            ),
            description: PeriodCompareNarrationStrings.string(
                "compare.aiNarrative.description",
                "Ask Helix to explain the deterministic period-over-period analytics \u{2014} which "
                    + "one or two metrics moved most between Period A and Period B, with directional "
                    + "phrasing keyed to the percent_change sign. The numbers are the same the chart "
                    + "and table below show; the narrator only explains them and is honest about "
                    + "zero-baseline windows and best-effort cost figures."
            ),
            badge: PeriodCompareNarrationStrings.string("compare.aiNarrative.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: PeriodCompareNarrationAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `PeriodCompareNarrationOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: PeriodCompareNarrationStreamSnapshot,
        canStart: Bool
    ) -> PeriodCompareNarrationResolvedOutput {
        let title = PeriodCompareNarrationStrings.string(
            "compare.output.a11yTitle",
            "Period comparison narration"
        )
        switch PeriodCompareNarrationOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? PeriodCompareNarrationStrings.string(
                    "compare.output.emptyHint",
                    "No narration yet \u{2014} ask Helix to narrate the period comparison."
                )
                : PeriodCompareNarrationStrings.string(
                    "compare.output.noVehicleHint",
                    "Select a vehicle to ask Helix to narrate the period comparison."
                )
            return PeriodCompareNarrationResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = PeriodCompareNarrationStrings.string("helix.thinking", "Helix is thinking…")
            return PeriodCompareNarrationResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return PeriodCompareNarrationResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: PeriodCompareNarrationAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = PeriodCompareNarrationStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? PeriodCompareNarrationStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return PeriodCompareNarrationResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
