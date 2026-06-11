//
//  AIVehiclePaintPreview.Projection.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  The pure projection from the coalesced input snapshot to the resolved view-state — extracted from
//  the state holder so the web component body (the `withAiFeature` gate, the `AIFeatureCard` header /
//  description / Preview-paint-color button, the `canStart = numericVehicleId > 0` rule, the
//  `emptyHint` shown when no vehicle is in scope, and the `AiOutputPanel` branches) plus the P4 leaf
//  contract stay unit testable in isolation (no store, no SwiftUI). Localization is applied here
//  (P1/S10) so the view is a pure function of the result.
//

import Foundation

// MARK: - Projection (web component body + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// `AIVehiclePaintPreview` render plus the `withAiFeature` gate and the P4 leaf contract. Unit tested
/// across gated / loading / error / ready, the `canStart = numericVehicleId > 0` rule, the header
/// `emptyHint`, the Ask-Helix label flip, and every `AiOutputPanel` branch.
public enum PaintPreviewProjection {
    public static func resolve(
        _ input: PaintPreviewInput,
        locale: Locale = .current
    ) -> PaintPreviewResolved {
        switch input.availability {
        case .loading:
            return PaintPreviewResolved(phase: .loading)
        case let .failed(message):
            return PaintPreviewResolved(phase: .error(message))
        case let .resolved(enabled):
            guard enabled else { return PaintPreviewResolved(phase: .gated) }
            return PaintPreviewResolved(phase: .ready, ready: ready(for: input, locale: locale))
        }
    }

    // MARK: Ready card (web `AIFeatureCard` props + derived button + output)

    private static func ready(
        for input: PaintPreviewInput,
        locale _: Locale
    ) -> PaintPreviewReady {
        // Web `numericVehicleId = Number.isFinite(vehicleId) ? vehicleId : 0; haveInputs =
        // numericVehicleId > 0`: the card needs a positive vehicle id (the handler validates
        // vehicleID > 0), so nil / non-positive ids keep the button disabled and ship the `/0/`
        // sentinel URL. The gate lives in the request type so the URL + body shape + canStart stay in
        // lockstep (tested in the adapter).
        let canStart = PaintPreviewRequest(
            vehicleID: input.vehicleID,
            styleHint: input.styleHint
        ).haveInputs
        let action = PaintPreviewAction.derive(canStart: canStart, state: input.stream.state)

        let buttonContext = PaintPreviewStrings.string(
            "vehicles.aiPaintPreview.button",
            "Preview paint color"
        )
        let askHelix = PaintPreviewStrings.string("helix.askHelix", "Ask Helix")
        let thinking = PaintPreviewStrings.string("helix.thinking", "Helix is thinking…")
        let actionTitle = action.isStreaming ? thinking : askHelix

        // Web `emptyHint={haveInputs ? undefined : t('…noVehicleHint', 'Open a vehicle detail page to
        // enable Helix.')}`, rendered by AIFeatureCard only when `!canStart`. Reproduced as the
        // header-region hint beneath the description.
        let vehicleHint = canStart
            ? nil
            : PaintPreviewStrings.string(
                "vehicles.aiPaintPreview.noVehicleHint",
                "Open a vehicle detail page to enable Helix."
            )

        return PaintPreviewReady(
            title: PaintPreviewStrings.string(
                "vehicles.aiPaintPreview.title",
                "Draft a Helix paint preview"
            ),
            description: PaintPreviewStrings.string(
                "vehicles.aiPaintPreview.description",
                "Ask Helix to draft a propose-only paint-color image prompt for this vehicle. Helix "
                    + "only sees the redacted vehicle context (model, trim, current exterior color) "
                    + "\u{2014} never the display name, VIN, license plate, or location. The draft is "
                    + "never applied automatically; review the proposed image prompt here, then use "
                    + "the existing Color setting below to apply the new paint if you\u{2019}d like to "
                    + "keep it."
            ),
            badge: PaintPreviewStrings.string("vehicles.aiPaintPreview.badge", "Helix"),
            buttonContext: buttonContext,
            actionTitle: actionTitle,
            actionAccessibilityLabel: PaintPreviewAccessibility.actionLabel(
                ask: askHelix,
                context: buttonContext
            ),
            canStart: canStart,
            vehicleHint: vehicleHint,
            action: action,
            output: output(for: input.stream, canStart: canStart)
        )
    }

    // MARK: Output panel (web `AiOutputPanel` branches, localized)

    /// Localizes the structural `PaintPreviewOutputKind` into the view-ready output. The friendly
    /// empty hint distinguishes the no-vehicle case (web button disabled) from the started-but-idle
    /// case, keeping the P4 "never a blank box" rule while preserving the web `canStart` semantics.
    private static func output(
        for snapshot: PaintPreviewStreamSnapshot,
        canStart: Bool
    ) -> PaintPreviewResolvedOutput {
        let title = PaintPreviewStrings.string(
            "vehicles.aiPaintPreview.output.a11yTitle",
            "Paint preview prompt"
        )
        switch PaintPreviewOutput.derive(snapshot) {
        case .empty:
            let hint = canStart
                ? PaintPreviewStrings.string(
                    "vehicles.aiPaintPreview.output.emptyHint",
                    "No preview yet \u{2014} ask Helix to draft a paint-color image prompt."
                )
                : PaintPreviewStrings.string(
                    "vehicles.aiPaintPreview.output.noVehicleHint",
                    "Open a vehicle detail page to draft a paint-color image prompt."
                )
            return PaintPreviewResolvedOutput(
                kind: .empty,
                body: hint,
                accessibilityLabel: hint
            )
        case .thinking:
            let label = PaintPreviewStrings.string("helix.thinking", "Helix is thinking…")
            return PaintPreviewResolvedOutput(kind: .thinking, body: label, accessibilityLabel: label)
        case let .prose(text):
            return PaintPreviewResolvedOutput(
                kind: .prose,
                body: text,
                accessibilityLabel: PaintPreviewAccessibility.outputLabel(title, text)
            )
        case let .failed(message):
            let prefix = PaintPreviewStrings.string("helix.errorLabel", "Helix error:")
            let detail = message.isEmpty
                ? PaintPreviewStrings.string("ai.common.errorUnknown", "unknown")
                : message
            let body = "\(prefix) \(detail)"
            return PaintPreviewResolvedOutput(kind: .failed, body: body, accessibilityLabel: body)
        }
    }
}
