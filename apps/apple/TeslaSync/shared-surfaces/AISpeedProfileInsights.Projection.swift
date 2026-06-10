//
//  AISpeedProfileInsights.Projection.swift
//  TeslaSync — P4 shared surface · 0049 · AISpeedProfileInsights (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = !!driveId` rule, and the
//  `AiOutputPanel` branches) plus the P4 leaf contract stay unit testable in isolation (no store, no
//  SwiftUI). Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AISpeedProfileInsights` render plus the `withAiFeature` gate and the P4 leaf contract. Unit
/// tested across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and
/// every `AiOutputPanel` branch.
public enum SpeedProfileInsightsProjection {
    public static func resolve(
        _ input: SpeedProfileInsightsInput,
        locale: Locale = .current
    ) -> SpeedProfileInsightsResolved {
        switch input.availability {
        case .loading:
            return SpeedProfileInsightsResolved(phase: .loading)
        case let .failed(message):
            return SpeedProfileInsightsResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return SpeedProfileInsightsResolved(phase: .gated) }
            return SpeedProfileInsightsResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: SpeedProfileInsightsInput,
        locale _: Locale
    ) -> SpeedProfileInsightsReady {
        // Web `canStart={!!driveId}`: the insights call needs a non-empty driveId in the {driveID}
        // path slot, so nil / "" keep the button disabled. The id is an opaque string carried by the
        // URL — any non-empty value passes.
        let canStart = (input.driveID?.isEmpty == false)
        let action = SpeedProfileInsightsAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = SpeedProfileInsightsStrings.string(
            "driveDetail.aiSpeedProfile.generateButton",
            "Generate insights"
        )
        let askHelix = SpeedProfileInsightsStrings.string("helix.askHelix", "Ask Helix")
        let thinking = SpeedProfileInsightsStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return SpeedProfileInsightsReady(
            title: SpeedProfileInsightsStrings.string(
                "driveDetail.aiSpeedProfile.title",
                "Speed-profile insights"
            ),
            description: SpeedProfileInsightsStrings.string(
                "driveDetail.aiSpeedProfile.description",
                "Get a short plain-language interpretation of this drive’s speed regime distribution — "
                    + "city / suburban / highway buckets, outliers, and how the speed envelope compares to a "
                    + "typical drive — generated from the same per-drive aggregates shown in the chart."
            ),
            badge: SpeedProfileInsightsStrings.string("driveDetail.aiSpeedProfile.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: SpeedProfileInsightsAccessibility.actionLabel(
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
    /// distinguishes the no-drive case (web button disabled) from the started-but-idle case,
    /// keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: SpeedProfileInsightsStreamSnapshot,
        canStart: Bool
    ) -> SpeedProfileInsightsResolvedOutput {
        let title = SpeedProfileInsightsStrings.string(
            "driveDetail.aiSpeedProfile.output.a11yTitle",
            "Speed-profile insights"
        )
        switch SpeedProfileInsightsOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? SpeedProfileInsightsStrings.string(
                    "driveDetail.aiSpeedProfile.output.emptyHint",
                    "No insights yet — ask Helix to interpret the speed profile of this drive."
                )
                : SpeedProfileInsightsStrings.string(
                    "driveDetail.aiSpeedProfile.output.noDriveHint",
                    "Open a drive to ask Helix for speed-profile insights."
                )
            return SpeedProfileInsightsResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = SpeedProfileInsightsStrings.string("helix.thinking", "Helix is thinking…")
            return SpeedProfileInsightsResolvedOutput(
                kind: .thinking,
                body: label,
                accessibilityLabel: label
            )
        case let .prose(text):
            return SpeedProfileInsightsResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: SpeedProfileInsightsAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = SpeedProfileInsightsStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? SpeedProfileInsightsStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return SpeedProfileInsightsResolvedOutput(
                kind: .failed,
                body: body,
                accessibilityLabel: body
            )
        }
    }
}
