//
//  AIPredictiveMaintenance.Projection.swift
//  TeslaSync — P4 shared surface · 0039 · AIPredictiveMaintenance (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = haveScope` rule, the `emptyHint` shown
//  beneath the description when `!canStart`, and the `AiOutputPanel` branches) plus the P4 leaf
//  contract stay unit testable in isolation (no store, no SwiftUI). Localization is applied here
//  (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIPredictiveMaintenance` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart = haveScope` rule (incl. the nil /
/// 0 / negative out-of-scope boundaries), the `emptyHint`, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum PredictiveMaintenanceProjection {
    public static func resolve(
        _ input: PredictiveMaintenanceInput,
        locale: Locale = .current
    ) -> PredictiveMaintenanceResolved {
        switch input.availability {
        case .loading:
            return PredictiveMaintenanceResolved(phase: .loading)
        case let .failed(message):
            return PredictiveMaintenanceResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return PredictiveMaintenanceResolved(phase: .gated) }
            return PredictiveMaintenanceResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: PredictiveMaintenanceInput,
        locale _: Locale
    ) -> PredictiveMaintenanceReady {
        // Web `haveScope = typeof vehicleId === 'number' && Number.isFinite(vehicleId) && vehicleId > 0`,
        // and `canStart={haveScope}`. Reuse the adapter's rule so the gate, the request body, and the
        // button stay a single source of truth: nil / 0 / negative ids are out of scope.
        let canStart = PredictiveMaintenanceRequest(vehicleID: input.vehicleID).haveScope
        let action = PredictiveMaintenanceAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = PredictiveMaintenanceStrings.string(
            "maintenance.aiPredictive.button",
            "Predict maintenance"
        )
        let askHelix = PredictiveMaintenanceStrings.string("helix.askHelix", "Ask Helix")
        let thinking = PredictiveMaintenanceStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint = haveScope ? undefined : t('…emptyHint', 'Select a vehicle first.')`, which
        // the card renders only when `!canStart`. Carry it as nil once a vehicle is in scope.
        let emptyHint = canStart
            ? nil
            : PredictiveMaintenanceStrings.string(
                "maintenance.aiPredictive.emptyHint",
                "Select a vehicle first."
            )

        return PredictiveMaintenanceReady(
            title: PredictiveMaintenanceStrings.string(
                "maintenance.aiPredictive.title",
                "Helix maintenance advisor"
            ),
            description: PredictiveMaintenanceStrings.string(
                "maintenance.aiPredictive.description",
                "Get a 3-6 sentence factual narrative of upcoming maintenance risks. The advisor "
                    + "reads only the deterministic maintenance envelope (per-vehicle scheduled "
                    + "items, recent service records, current mileage when available) — VINs, "
                    + "coordinates, place names, IPs, and personal identifiers are redacted before "
                    + "the message reaches the provider. The narrative is informational; the "
                    + "reminders, status badges, and upcoming items list above remain the canonical "
                    + "raw view."
            ),
            badge: PredictiveMaintenanceStrings.string("maintenance.aiPredictive.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: PredictiveMaintenanceAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            emptyHint: emptyHint,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `PredictiveMaintenanceOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled) from the
    /// in-scope-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: PredictiveMaintenanceStreamSnapshot,
        canStart: Bool
    ) -> PredictiveMaintenanceResolvedOutput {
        let title = PredictiveMaintenanceStrings.string(
            "maintenance.aiPredictive.output.a11yTitle",
            "Maintenance advisory"
        )
        switch PredictiveMaintenanceOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? PredictiveMaintenanceStrings.string(
                    "maintenance.aiPredictive.output.emptyHint",
                    "No advisory yet — ask Helix to predict upcoming maintenance for this vehicle."
                )
                : PredictiveMaintenanceStrings.string(
                    "maintenance.aiPredictive.output.noVehicleHint",
                    "Select a vehicle to get a maintenance-risk narrative."
                )
            return PredictiveMaintenanceResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = PredictiveMaintenanceStrings.string("helix.thinking", "Helix is thinking…")
            return PredictiveMaintenanceResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return PredictiveMaintenanceResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: PredictiveMaintenanceAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = PredictiveMaintenanceStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? PredictiveMaintenanceStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return PredictiveMaintenanceResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
