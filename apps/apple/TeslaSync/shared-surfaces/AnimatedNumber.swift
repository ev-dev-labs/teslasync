//
//  AnimatedNumber.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  The SwiftUI parity of `components/data-display/AnimatedNumber.tsx`: a presentational view that
//  counts a number up from zero to `value` over `duration` seconds with an ease-out-quad curve,
//  formats it with locale-aware grouping and a fixed fraction-digit count, and brackets it with an
//  optional prefix / suffix. The digits are monospaced (web `tabular-nums`) so the figure does not
//  shimmer-shift as it rolls.
//
//  The view binds the `AnimatedNumberModel` state-holder (P1/S8) for the formatting projection and the
//  once-only `view.opened` telemetry (P1/S11); no networking lives in the view. The actual tween is a
//  reduce-motion-aware SwiftUI animation driven by the `AnimatedNumberRoller` subview (see
//  AnimatedNumber.Views.swift), which restarts from zero whenever the value or duration changes — the
//  parity of the web effect re-running on `[value, duration]`.
//

import SwiftUI

/// The count-up number display — the SwiftUI parity of the web `AnimatedNumber`. Tweens from zero to
/// `value`, formats per the locale + precision, and voices the settled figure to VoiceOver.
public struct AnimatedNumber: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AnimatedNumberMeta.surfaceSlug

    private let input: AnimatedNumberInput
    @State private var model: AnimatedNumberModel

    /// Designated initializer — adopts a fully-formed input snapshot and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests).
    public init(
        input: AnimatedNumberInput,
        telemetry: any AnimatedNumberTelemetry = OSLogAnimatedNumberTelemetry()
    ) {
        self.input = input
        _model = State(initialValue: AnimatedNumberModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<AnimatedNumber value={…} duration={…} decimals={…} prefix={…} suffix={…} />`.
    public init(
        value: Double,
        duration: Double = AnimatedNumberMeta.defaultDuration,
        decimals: Int = AnimatedNumberMeta.defaultDecimals,
        prefix: String? = nil,
        suffix: String? = nil,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.init(input: AnimatedNumberInput(
            value: value,
            duration: duration,
            decimals: decimals,
            prefix: prefix,
            suffix: suffix,
            locale: locale
        ))
    }

    public var body: some View {
        AnimatedNumberRoller(
            value: input.value,
            duration: input.duration,
            format: model.format
        )
        // Re-identify on the web effect's dependencies (`value`, `duration`) so the roller remounts
        // and the count restarts from zero — the parity of the effect re-running. The value is
        // sanitised so a non-finite input cannot thrash the identity (NaN != NaN).
        .id(AnimatedNumberAnimationKey(
            value: AnimatedNumberFormatting.safe(input.value),
            duration: AnimatedNumberProjection.clampedDuration(input.duration)
        ))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.settledText))
        .accessibilityAddTraits(.updatesFrequently)
        .onAppear { model.start() }
        .onChange(of: input) { _, newInput in model.sync(newInput) }
    }
}

/// The identity key that drives the restart-from-zero behaviour: the surface remounts its roller when
/// either the (sanitised) target value or the (sanitised) duration changes, matching the web effect's
/// `[value, duration]` dependency list.
struct AnimatedNumberAnimationKey: Hashable {
    let value: Double
    let duration: Double
}
