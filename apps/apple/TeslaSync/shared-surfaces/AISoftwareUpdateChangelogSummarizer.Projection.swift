//
//  AISoftwareUpdateChangelogSummarizer.Projection.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Ask-Helix button, the `canStart = numericVehicleId > 0` rule, the
//  `emptyHint = haveInputs ? undefined : noVehicleHint` header hint, and the `AiOutputPanel`
//  branches) plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//  Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AISoftwareUpdateChangelogSummarizer` render plus the `withAiFeature` gate and the P4 leaf
/// contract. Unit tested across gated / loading / error / ready, the `canStart` rule, the header
/// empty-hint flip, the Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum SoftwareUpdateSummarizerProjection {
    public static func resolve(
        _ input: SoftwareUpdateSummarizerInput,
        locale: Locale = .current
    ) -> SoftwareUpdateSummarizerResolved {
        switch input.availability {
        case .loading:
            return SoftwareUpdateSummarizerResolved(phase: .loading)
        case let .failed(message):
            return SoftwareUpdateSummarizerResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return SoftwareUpdateSummarizerResolved(phase: .gated) }
            return SoftwareUpdateSummarizerResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + header hint + output)

    private static func ready(
        for input: SoftwareUpdateSummarizerInput,
        locale _: Locale
    ) -> SoftwareUpdateSummarizerReady {
        // Web `haveInputs = numericVehicleId > 0`: the summarizer needs a positive vehicle id in the
        // body (mirrors the handler-side `vehicle_id` parser), so nil / 0 / negative keep the button
        // disabled and surface the header empty hint. The id is the already-coerced
        // `Number(vehicleId)` (0008 narrate precedent: the string→number coercion happens at the
        // source boundary).
        let canStart = (input.vehicleID ?? 0) > 0
        let action = SoftwareUpdateSummarizerAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = SoftwareUpdateSummarizerStrings.string(
            "softwareUpdates.aiNarration.button",
            "Summarize updates"
        )
        let askHelix = SoftwareUpdateSummarizerStrings.string("helix.askHelix", "Ask Helix")
        let thinking = SoftwareUpdateSummarizerStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint = haveInputs ? undefined : t('…noVehicleHint', 'Pick a vehicle above to
        // enable Helix.')` — the header hint beneath the description, shown only when no vehicle is
        // in scope.
        let emptyHint = canStart
            ? nil
            : SoftwareUpdateSummarizerStrings.string(
                "softwareUpdates.aiNarration.noVehicleHint",
                "Pick a vehicle above to enable Helix."
            )

        return SoftwareUpdateSummarizerReady(
            title: SoftwareUpdateSummarizerStrings.string(
                "softwareUpdates.aiNarration.title",
                "Summarize my software update history"
            ),
            description: SoftwareUpdateSummarizerStrings.string(
                "softwareUpdates.aiNarration.description",
                "Ask Helix to walk through your firmware update history \u{2014} the current version, "
                    + "the install cadence, and the headline release-note themes. The narrator quotes "
                    + "only the deterministic update events your vehicle reported plus public Tesla "
                    + "release notes for the versions you have installed; it never invents firmware "
                    + "versions or claims features your installed build does not have."
            ),
            badge: SoftwareUpdateSummarizerStrings.string("softwareUpdates.aiNarration.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: SoftwareUpdateSummarizerAccessibility.actionLabel(
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

    /// Localizes the structural `SoftwareUpdateSummarizerOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-vehicle case (web button disabled + header hint) from
    /// the vehicle-selected-but-idle case, keeping the P4 "never a blank box" rule while preserving
    /// the web `canStart` semantics. The no-vehicle output hint is intentionally distinct from the
    /// header empty hint so the two do not read as a literal duplicate.
    private static func output(
        for snapshot: SoftwareUpdateSummarizerStreamSnapshot,
        canStart: Bool
    ) -> SoftwareUpdateSummarizerResolvedOutput {
        let title = SoftwareUpdateSummarizerStrings.string(
            "softwareUpdates.aiNarration.output.a11yTitle",
            "Software update history summary"
        )
        switch SoftwareUpdateSummarizerOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? SoftwareUpdateSummarizerStrings.string(
                    "softwareUpdates.aiNarration.output.emptyHint",
                    "No summary yet \u{2014} ask Helix to summarize your software update history."
                )
                : SoftwareUpdateSummarizerStrings.string(
                    "softwareUpdates.aiNarration.output.noVehicleHint",
                    "Pick a vehicle above, then ask Helix to summarize its update history."
                )
            return SoftwareUpdateSummarizerResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = SoftwareUpdateSummarizerStrings.string("helix.thinking", "Helix is thinking…")
            return SoftwareUpdateSummarizerResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return SoftwareUpdateSummarizerResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: SoftwareUpdateSummarizerAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = SoftwareUpdateSummarizerStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? SoftwareUpdateSummarizerStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return SoftwareUpdateSummarizerResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
