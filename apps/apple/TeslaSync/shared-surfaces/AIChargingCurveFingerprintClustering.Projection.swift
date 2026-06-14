//
//  AIChargingCurveFingerprintClustering.Projection.swift
//  TeslaSync — P4 shared surface · 0010 · AIChargingCurveFingerprintClustering (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `haveInputs = Number.isFinite(numericVehicleId) &&
//  numericVehicleId > 0` rule, and the `AiOutputPanel` branches) plus the P4 leaf contract stay unit
//  testable in isolation (no store, no SwiftUI). Localization is applied here (P1/S10) so the view is
//  a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIChargingCurveFingerprintClustering` render plus the `withAiFeature` gate and the P4 leaf
/// contract. Unit tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix
/// label flip, and every `AiOutputPanel` branch.
public enum ChargeCurveFingerprintProjection {
    public static func resolve(
        _ input: ChargeCurveFingerprintInput,
        locale: Locale = .current
    ) -> ChargeCurveFingerprintResolved {
        switch input.availability {
        case .loading:
            return ChargeCurveFingerprintResolved(phase: .loading)
        case let .failed(message):
            return ChargeCurveFingerprintResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return ChargeCurveFingerprintResolved(phase: .gated) }
            return ChargeCurveFingerprintResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: ChargeCurveFingerprintInput,
        locale _: Locale
    ) -> ChargeCurveFingerprintReady {
        // Web `canStart={haveInputs}` where `haveInputs = Number.isFinite(numericVehicleId) &&
        // numericVehicleId > 0`. A nil / non-numeric / non-positive id keeps the button disabled; the
        // explain call needs a real vehicle in scope. The coercion lives on the vehicle-id value.
        let canStart = input.vehicleID.canStart
        let action = ChargeCurveFingerprintAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = ChargeCurveFingerprintStrings.string(
            "charging.aiClustering.generateButton",
            "Explain clusters"
        )
        let askHelix = ChargeCurveFingerprintStrings.string("helix.askHelix", "Ask Helix")
        let thinking = ChargeCurveFingerprintStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return ChargeCurveFingerprintReady(
            title: ChargeCurveFingerprintStrings.string(
                "charging.aiClustering.title",
                "Explain the charging-curve cluster fingerprints"
            ),
            description: ChargeCurveFingerprintStrings.string(
                "charging.aiClustering.description",
                "Ask Helix to name and explain each deterministic charging-curve cluster fingerprint. "
                    + "The narrator never changes the cluster bucketing — it grounds every sentence in "
                    + "the same per-cluster numbers the curves below render."
            ),
            badge: ChargeCurveFingerprintStrings.string("charging.aiClustering.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: ChargeCurveFingerprintAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `ChargeCurveFingerprintOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: ChargeCurveFingerprintStreamSnapshot,
        canStart: Bool
    ) -> ChargeCurveFingerprintResolvedOutput {
        let title = ChargeCurveFingerprintStrings.string(
            "charging.aiClustering.output.a11yTitle",
            "Charging-curve cluster narrative"
        )
        switch ChargeCurveFingerprintOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? ChargeCurveFingerprintStrings.string(
                    "charging.aiClustering.output.emptyHint",
                    "No explanation yet — ask Helix to name and explain this vehicle’s "
                        + "charging-curve cluster fingerprints."
                )
                : ChargeCurveFingerprintStrings.string(
                    "charging.aiClustering.output.noVehicleHint",
                    "Select a vehicle to explain its charging-curve cluster fingerprints."
                )
            return ChargeCurveFingerprintResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = ChargeCurveFingerprintStrings.string("helix.thinking", "Helix is thinking…")
            return ChargeCurveFingerprintResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return ChargeCurveFingerprintResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: ChargeCurveFingerprintAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = ChargeCurveFingerprintStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? ChargeCurveFingerprintStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return ChargeCurveFingerprintResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
