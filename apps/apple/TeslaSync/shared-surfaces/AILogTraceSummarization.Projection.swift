//
//  AILogTraceSummarization.Projection.swift
//  TeslaSync — P4 shared surface · 0026 · AILogTraceSummarization (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Ask-Helix button, the `canStart = windowAcceptable` rule, and the `AiOutputPanel`
//  branches) plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//  Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AILogTraceSummarization` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart = windowAcceptable` rule, the
/// Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum LogTraceSummaryProjection {
    public static func resolve(
        _ input: LogTraceSummaryInput,
        locale: Locale = .current
    ) -> LogTraceSummaryResolved {
        switch input.availability {
        case .loading:
            return LogTraceSummaryResolved(phase: .loading)
        case let .failed(message):
            return LogTraceSummaryResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return LogTraceSummaryResolved(phase: .gated) }
            return LogTraceSummaryResolved(
                phase: .ready,
                ready: ready(for: input, locale: locale)
            )
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: LogTraceSummaryInput, locale _: Locale) -> LogTraceSummaryReady {
        // Web `canStart={windowAcceptable}` — the in-scope window must be present, ordered, and
        // within the 24-hour cap. The vehicle is NOT part of the gate (it only narrows the body).
        let canStart = LogTraceWindow.isAcceptable(fromUnix: input.fromUnix, toUnix: input.toUnix)
        let action = LogTraceSummaryAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = LogTraceSummaryStrings.string("liveLogs.aiSummary.button", "Summarize")
        let askHelix = LogTraceSummaryStrings.string("helix.askHelix", "Ask Helix")
        let thinking = LogTraceSummaryStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return LogTraceSummaryReady(
            title: LogTraceSummaryStrings.string(
                "liveLogs.aiSummary.title",
                "Helix log/trace summary"
            ),
            description: LogTraceSummaryStrings.string(
                "liveLogs.aiSummary.description",
                "Get a 3-6 sentence factual summary of the recent log and trace window. The narrator "
                    + "is grounded in a redacted envelope of the same window the table below shows; it "
                    + "never invents log lines and never speculates about root cause."
            ),
            badge: LogTraceSummaryStrings.string("liveLogs.aiSummary.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: LogTraceSummaryAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `LogTraceSummaryOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-window case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: LogTraceSummaryStreamSnapshot,
        canStart: Bool
    ) -> LogTraceSummaryResolvedOutput {
        let title = LogTraceSummaryStrings.string(
            "liveLogs.aiSummary.output.a11yTitle",
            "Log and trace summary"
        )
        switch LogTraceSummaryOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? LogTraceSummaryStrings.string(
                    "liveLogs.aiSummary.output.emptyHint",
                    "No summary yet \u{2014} ask Helix to summarize the recent log and trace window."
                )
                : LogTraceSummaryStrings.string(
                    "liveLogs.aiSummary.output.noWindowHint",
                    "Waiting for a log and trace window to summarize."
                )
            return LogTraceSummaryResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = LogTraceSummaryStrings.string("helix.thinking", "Helix is thinking…")
            return LogTraceSummaryResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return LogTraceSummaryResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: LogTraceSummaryAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = LogTraceSummaryStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? LogTraceSummaryStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return LogTraceSummaryResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
