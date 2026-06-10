//
//  AIDriveCoaching.Projection.swift
//  TeslaSync — P4 shared surface · 0017 · AIDriveCoaching (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted
//  from the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard`
//  header / description / Ask-Helix button, the `canStart = !!driveId` rule, and the `AiOutputPanel`
//  branches) plus the P4 leaf contract stay unit testable in isolation (no store, no SwiftUI).
//  Localization is applied here (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIDriveCoaching` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart` rule, the Ask-Helix label flip, and every
/// `AiOutputPanel` branch.
public enum DriveCoachingProjection {
    public static func resolve(
        _ input: DriveCoachingInput,
        locale: Locale = .current
    ) -> DriveCoachingResolved {
        switch input.availability {
        case .loading:
            return DriveCoachingResolved(phase: .loading)
        case let .failed(message):
            return DriveCoachingResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return DriveCoachingResolved(phase: .gated) }
            return DriveCoachingResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(for input: DriveCoachingInput, locale _: Locale) -> DriveCoachingReady {
        // Web `canStart={!!driveId}`: the coaching call needs a non-empty drive id in the path, so
        // nil / "" keep the button disabled. Unlike 0008's narrate (`numericVehicleId > 0`), the id
        // is an opaque string carried by the URL — any non-empty value passes.
        let canStart = (input.driveID?.isEmpty == false)
        let action = DriveCoachingAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = DriveCoachingStrings.string(
            "driveDetail.aiCoaching.generateButton",
            "Generate coaching"
        )
        let askHelix = DriveCoachingStrings.string("helix.askHelix", "Ask Helix")
        let thinking = DriveCoachingStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        return DriveCoachingReady(
            title: DriveCoachingStrings.string(
                "driveDetail.aiCoaching.title",
                "Drive coaching"
            ),
            description: DriveCoachingStrings.string(
                "driveDetail.aiCoaching.description",
                "Get a 2-4 paragraph plain-language coaching summary of this drive — efficiency, "
                    + "regen use, and notable braking or acceleration moments — generated from the "
                    + "same per-drive metrics shown above."
            ),
            badge: DriveCoachingStrings.string("driveDetail.aiCoaching.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: DriveCoachingAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `DriveCoachingOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-drive case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: DriveCoachingStreamSnapshot,
        canStart: Bool
    ) -> DriveCoachingResolvedOutput {
        let title = DriveCoachingStrings.string("driveDetail.aiCoaching.output.a11yTitle", "Drive coaching narrative")
        switch DriveCoachingOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? DriveCoachingStrings.string(
                    "driveDetail.aiCoaching.output.emptyHint",
                    "No coaching yet — ask Helix to coach this drive."
                )
                : DriveCoachingStrings.string(
                    "driveDetail.aiCoaching.output.noDriveHint",
                    "Open a drive to ask Helix to coach it."
                )
            return DriveCoachingResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = DriveCoachingStrings.string("helix.thinking", "Helix is thinking…")
            return DriveCoachingResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return DriveCoachingResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: DriveCoachingAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = DriveCoachingStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? DriveCoachingStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return DriveCoachingResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
