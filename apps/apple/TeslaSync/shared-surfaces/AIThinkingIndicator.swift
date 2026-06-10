//
//  AIThinkingIndicator.swift
//  TeslaSync — P4 shared surface · 0053 · AIThinkingIndicator (Apple)
//
//  The SwiftUI parity of `components/ai/AIThinkingIndicator.tsx`, which exports two presentational
//  pieces with no data dependency (it reads only `useTranslation`):
//
//    • `AIThinkingIndicator` — the streaming-but-empty state shown while the SSE connection is open
//      and the first `delta.text` frame has not arrived: a pulsing Helix mark + an animated label +
//      bouncing dots, above three shimmering skeleton lines. Binds through `AIThinkingIndicatorModel`
//      (P1/S8) so the leading label resolves through the i18n facade and the `view.opened` event
//      (P1/S11) fires once on first appearance. No networking lives in the view.
//
//    • `AIThinkingDots` — the compact in-button form: a caller-supplied label followed by the three
//      bouncing dots, for an action button's streaming state where the full skeleton is too tall.
//      Pure and decorative (the web export takes a required `label` and reads no hooks), so it holds
//      no model and emits no telemetry — it is part of its host control, not a surface open.
//
//  Both pieces are reduce-motion-aware via the subviews (web `motion-safe:`): the pulse and bounce
//  rest and the shimmer drops under Reduce Motion, leaving the static skeleton — never a blank box.
//

import SwiftUI

// MARK: - AIThinkingIndicator (the full surface)

/// The full streaming-pending indicator — the SwiftUI parity of the web `AIThinkingIndicator`.
/// Renders the pulsing Helix mark, the animated label, the bouncing dots, and the three shimmering
/// skeleton lines, binding the resolved label through `AIThinkingIndicatorModel`.
public struct AIThinkingIndicator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AIThinkingIndicatorMeta.surfaceSlug

    @State private var model: AIThinkingIndicatorModel

    public init(model: AIThinkingIndicatorModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production label-resolving model — the parity of mounting
    /// `<AIThinkingIndicator label={…} />`. Pass a translated string to override the default
    /// `helix.thinking` label (e.g. a domain-specific verb); pass `nil` for the default.
    public init(label: String? = nil) {
        _model = State(initialValue: AIThinkingIndicatorModel(
            input: AIThinkingIndicatorInput(labelOverride: label)
        ))
    }

    public var body: some View {
        AIThinkingFullContent(label: model.label)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - AIThinkingDots (the compact in-button form)

/// The compact in-button thinking indicator — the SwiftUI parity of the web `AIThinkingDots`. A
/// label followed by three small bouncing dots, suitable as the streaming-state label on an action
/// button. Pure and decorative; the dots inherit the current foreground (web `bg-current`).
public struct AIThinkingDots: View {
    private let label: String

    public init(label: String) {
        self.label = label
    }

    public var body: some View {
        AIThinkingCompactContent(label: label)
    }
}
