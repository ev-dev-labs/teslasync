//
//  ProgressRing.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  The SwiftUI parity of `components/data-display/ProgressRing.tsx`: a presentational circular gauge
//  that paints a track ring, fills an arc from zero to `value / max`, and brackets it with an optional
//  centered primary / secondary label and an optional caption below. The view binds the
//  `ProgressRingModel` state-holder (P1/S8) for the resolved geometry + accessibility label and the
//  once-only `view.opened` telemetry (P1/S11); no networking lives in the view. The fill tint comes
//  from the use-site (web `color`), defaulting to the P1/S9 `Color.TS.accent` token.
//

import SwiftUI

/// The circular progress gauge — the SwiftUI parity of the web `ProgressRing`. Resolves its geometry
/// through the model, paints the track + animated fill arc + optional centered text + optional caption,
/// and voices the whole gauge to VoiceOver as one element.
public struct ProgressRing: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ProgressRingMeta.surfaceSlug

    private let input: ProgressRingInput
    private let color: Color
    @State private var model: ProgressRingModel

    /// Designated initializer — adopts a fully-formed input snapshot, the fill tint, and an injectable
    /// telemetry sink (the production `os.Logger` default, a spy in tests). A `nil` tint resolves to the
    /// P1/S9 `Color.TS.accent` token (the parity of the web `color` default `#3b82f6`); the token is
    /// resolved in the body rather than the signature so it stays out of the public default argument.
    public init(
        input: ProgressRingInput,
        color: Color? = nil,
        telemetry: any ProgressRingTelemetry = OSLogProgressRingTelemetry()
    ) {
        self.input = input
        self.color = color ?? Color.TS.accent
        _model = State(initialValue: ProgressRingModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<ProgressRing value={…} max={…} size={…} strokeWidth={…} color={…} label={…}
    /// centerLabel={…} centerSubLabel={…} />`. A `nil` `color` resolves to the accent token.
    public init(
        value: Double,
        max: Double = ProgressRingMeta.defaultMax,
        size: Double = ProgressRingMeta.defaultSize,
        strokeWidth: Double = ProgressRingMeta.defaultStrokeWidth,
        color: Color? = nil,
        label: String? = nil,
        centerLabel: String? = nil,
        centerSubLabel: String? = nil
    ) {
        self.init(
            input: ProgressRingInput(
                value: value,
                max: max,
                size: size,
                strokeWidth: strokeWidth,
                label: label,
                centerLabel: centerLabel,
                centerSubLabel: centerSubLabel
            ),
            color: color
        )
    }

    public var body: some View {
        ProgressRingGauge(
            resolved: model.resolved,
            input: input,
            color: color,
            accessibilityLabel: model.accessibilityLabel
        )
        .onAppear { model.start() }
        .onChange(of: input) { _, newInput in model.sync(newInput) }
    }
}
