//
//  AIIncidentTimelineSummarizer.Projection.swift
//  TeslaSync — P4 shared surface · 0022 · AIIncidentTimelineSummarizer (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Ask-Helix button, the `canStart = numericIncidentId > 0` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIIncidentTimelineSummarizer` render plus the `withAiFeature` gate and the P4 leaf contract.
/// Unit tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label
/// flip, and every `AiOutputPanel` branch.
public enum IncidentSummarizerProjection {
    public static func resolve(
        _ input: IncidentSummarizerInput,
        locale: Locale = .current
    ) -> IncidentSummarizerResolved {
        switch input.availability {
        case .loading:
            return IncidentSummarizerResolved(phase: .loading)
        case let .failed(message):
            return IncidentSummarizerResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return IncidentSummarizerResolved(phase: .gated) }
            return IncidentSummarizerResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: IncidentSummarizerInput,
        locale _: Locale
    ) -> IncidentSummarizerReady {
        // Web `haveIncident = Number.isFinite(numericIncidentId) && numericIncidentId > 0`: the
        // summarizer needs a positive incident id in the path (mirrors the handler-side
        // `incident_id` parser), so nil / 0 / negative keep the button disabled and use the
        // `…/0/summarize` fallback URL. The id is the already-coerced `Number(incidentId)` (0008
        // narrate precedent: the string→number coercion happens at the source boundary).
        let canStart = (input.incidentID ?? 0) > 0
        let action = IncidentSummarizerAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = IncidentSummarizerStrings.string(
            "incidentTimeline.aiSummary.button",
            "Summarize"
        )
        let askHelix = IncidentSummarizerStrings.string("helix.askHelix", "Ask Helix")
        let thinking = IncidentSummarizerStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return IncidentSummarizerReady(
            title: IncidentSummarizerStrings.string(
                "incidentTimeline.aiSummary.title",
                "Helix timeline summary"
            ),
            description: IncidentSummarizerStrings.string(
                "incidentTimeline.aiSummary.description",
                "Get a 3-6 sentence factual summary of this incident\u{2019}s timeline. The summary "
                    + "is grounded in the same deterministic envelope the timeline below shows; the "
                    + "narrator never invents updates and never speculates about root cause."
            ),
            badge: IncidentSummarizerStrings.string("incidentTimeline.aiSummary.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: IncidentSummarizerAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `IncidentSummarizerOutputKind` into the view-ready output. The
    /// friendly empty hint distinguishes the no-incident case (web button disabled) from the
    /// started-but-idle case, keeping the P4 "never a blank box" rule while preserving the web
    /// `canStart` semantics.
    private static func output(
        for snapshot: IncidentSummarizerStreamSnapshot,
        canStart: Bool
    ) -> IncidentSummarizerResolvedOutput {
        let title = IncidentSummarizerStrings.string(
            "incidentTimeline.aiSummary.output.a11yTitle",
            "Incident timeline summary"
        )
        switch IncidentSummarizerOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? IncidentSummarizerStrings.string(
                    "incidentTimeline.aiSummary.output.emptyHint",
                    "No summary yet — ask Helix to summarize this incident."
                )
                : IncidentSummarizerStrings.string(
                    "incidentTimeline.aiSummary.output.noIncidentHint",
                    "Open an incident to ask Helix to summarize it."
                )
            return IncidentSummarizerResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = IncidentSummarizerStrings.string("helix.thinking", "Helix is thinking…")
            return IncidentSummarizerResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return IncidentSummarizerResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: IncidentSummarizerAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = IncidentSummarizerStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? IncidentSummarizerStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return IncidentSummarizerResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
