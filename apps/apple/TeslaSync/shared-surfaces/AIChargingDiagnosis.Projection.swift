//
//  AIChargingDiagnosis.Projection.swift
//  TeslaSync — P4 shared surface · 0011 · AIChargingDiagnosis (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = !!sessionId` rule, and the `AiOutputPanel`
//  branches) plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//  Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIChargingDiagnosis` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum ChargingDiagnosisProjection {
    public static func resolve(
        _ input: ChargingDiagnosisInput,
        locale: Locale = .current
    ) -> ChargingDiagnosisResolved {
        switch input.availability {
        case .loading:
            return ChargingDiagnosisResolved(phase: .loading)
        case let .failed(message):
            return ChargingDiagnosisResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return ChargingDiagnosisResolved(phase: .gated) }
            return ChargingDiagnosisResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: ChargingDiagnosisInput, locale _: Locale) -> ChargingDiagnosisReady {
        // Web `canStart={!!sessionId}`: the diagnose call needs a non-empty session id in the path,
        // so nil / "" keep the button disabled. The id is an opaque string carried by the URL — any
        // non-empty value passes (a looser gate than a numeric vehicle-id field).
        let canStart = (input.sessionID?.isEmpty == false)
        let action = ChargingDiagnosisAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = ChargingDiagnosisStrings.string(
            "charging.detail.aiDiagnosis.generateButton",
            "Generate diagnosis"
        )
        let askHelix = ChargingDiagnosisStrings.string("helix.askHelix", "Ask Helix")
        let thinking = ChargingDiagnosisStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return ChargingDiagnosisReady(
            title: ChargingDiagnosisStrings.string(
                "charging.detail.aiDiagnosis.title",
                "Charging diagnosis"
            ),
            description: ChargingDiagnosisStrings.string(
                "charging.detail.aiDiagnosis.description",
                "Get a 2-4 paragraph plain-language explanation of any flags raised on this "
                    + "charging session — trickle, expensive, low-power, or interrupted — generated "
                    + "from the same deterministic aggregation metrics shown above."
            ),
            badge: ChargingDiagnosisStrings.string("charging.detail.aiDiagnosis.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: ChargingDiagnosisAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `ChargingDiagnosisOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-session case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: ChargingDiagnosisStreamSnapshot,
        canStart: Bool
    ) -> ChargingDiagnosisResolvedOutput {
        let title = ChargingDiagnosisStrings.string(
            "charging.detail.aiDiagnosis.output.a11yTitle",
            "Charging diagnosis narrative"
        )
        switch ChargingDiagnosisOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? ChargingDiagnosisStrings.string(
                    "charging.detail.aiDiagnosis.output.emptyHint",
                    "No diagnosis yet — ask Helix to diagnose this charging session."
                )
                : ChargingDiagnosisStrings.string(
                    "charging.detail.aiDiagnosis.output.noSessionHint",
                    "Open a charging session to ask Helix to diagnose it."
                )
            return ChargingDiagnosisResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = ChargingDiagnosisStrings.string("helix.thinking", "Helix is thinking…")
            return ChargingDiagnosisResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return ChargingDiagnosisResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: ChargingDiagnosisAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = ChargingDiagnosisStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? ChargingDiagnosisStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return ChargingDiagnosisResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
