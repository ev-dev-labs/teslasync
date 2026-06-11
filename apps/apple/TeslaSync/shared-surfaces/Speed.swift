//
//  Speed.swift
//  TeslaSync — P4 shared surface · 0088 · Speed (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Speed.tsx`: a presentational view that renders a
//  caller-supplied speed (`mph` preferred, `kmh` alternative) in the user's display unit (from settings,
//  the web `useUnits().unitPrefs.speed`), with a hover tooltip carrying the raw caller value in its
//  source unit. A no-value input falls back to an em dash (the web `<span>—</span>`).
//
//  The view binds the `SpeedModel` state-holder (P1/S8) for the formatting projection and the once-only
//  `view.opened` telemetry (P1/S11); no networking lives in the view. The colour and font are inherited
//  from the use-site (the web span carries none of its own), so callers tint the figure with the P1/S9
//  tokens.
//

import SwiftUI

/// The speed display — the SwiftUI parity of the web `Speed`. Renders `{number} {unit}` for a finite
/// `mph` / `kmh` (with the raw source value + source unit as a tooltip) or the `fallback` glyph
/// otherwise, and voices the on-screen content to VoiceOver.
public struct Speed: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SpeedMeta.surfaceSlug

    private let input: SpeedInput
    @State private var model: SpeedModel

    /// Designated initializer — adopts a fully-formed input snapshot (the production app threads the
    /// P1/S8 settings projection through `SpeedInput.settings`) and an injectable telemetry sink (the
    /// production `os.Logger` default, a spy in tests).
    public init(
        input: SpeedInput,
        telemetry: any SpeedTelemetry = OSLogSpeedTelemetry()
    ) {
        self.input = input
        _model = State(initialValue: SpeedModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Speed mph={…} kmh={…} precision={…} />`. `unitOfLength` is the user's `settings.unit_of_length`
    /// the web feeds `useUnits` (`"mi"` → mph, else km/h); `decimalPrecision` is the global fraction-
    /// digit default (the web `_globalPrecision`) used when `precision` is omitted.
    public init(
        mph: Double? = nil,
        kmh: Double? = nil,
        precision: Int? = nil,
        fallback: String = SpeedMeta.defaultFallback,
        unitOfLength: String? = nil,
        decimalPrecision: Int = SpeedMeta.defaultPrecision,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.init(input: SpeedInput(
            mph: mph,
            kmh: kmh,
            precision: precision,
            fallback: fallback,
            settings: SpeedDisplaySettings(rawUnitOfLength: unitOfLength, decimalPrecision: decimalPrecision),
            locale: locale
        ))
    }

    public var body: some View {
        SpeedText(resolved: model.resolved)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
            .onAppear { model.start() }
            .onChange(of: input) { _, newInput in model.sync(newInput) }
    }
}
