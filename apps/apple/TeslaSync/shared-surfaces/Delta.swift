//
//  Delta.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  The SwiftUI surface — the public API of the direction-aware change indicator, the parity of the web
//  `<Delta metric current previous display comparedTo size inline hideArrow loading precision />`.
//  Like the web component it is driven by its props plus the display-boundary unit/format facades; the
//  unit preferences bind through the app's `\.tsUnits` environment (P1/S8, the native peer of
//  `useUnits()` / `useFormatting()`), and the i18n facade (P1/S10) supplies the VoiceOver copy. The
//  view binds through ``DeltaModel`` for the derived projection + the once-only `view.opened`
//  telemetry (P1/S11), and pushes prop / unit changes into the holder via `.onChange` so a reused chip
//  re-renders faithfully. No networking, no Tailwind ports — chrome is token-driven (P1/S9).
//

import SwiftUI

/// The direction-aware change indicator — the SwiftUI parity of `components/data-display/Delta.tsx`.
/// Renders the three real branches of the web source (a forced skeleton while `loading`, a muted "—"
/// when either endpoint is missing / non-finite, and a sign-/tone-decorated indicator otherwise) as a
/// tight inline chip (`inline`, the default) or a roomier stat row. The arrow encodes the sign and the
/// absolute value is always rendered positive ("↓ 5%" never "↑ −5%"), exactly like the web.
public struct Delta: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DeltaSurface.slug

    private let inputs: DeltaInputs
    @State private var model: DeltaModel
    @Environment(\.tsUnits) private var units

    /// The prop-style initializer — the parity of `<Delta … />`. `metric` is a registered id
    /// (`.id("range")`), an explicit semantic, or an inline `.inline(direction:unit:)`; `current` /
    /// `previous` are the comparison endpoints in display units (`nil` / non-finite renders the muted
    /// "—"); the rest mirror the web defaults (`display = .percent`, `size = .sm`, `inline = true`).
    public init(
        metric: DeltaMetric,
        current: Double?,
        previous: Double?,
        display: DeltaDisplay = .defaultDisplay,
        comparedTo: String? = nil,
        size: DeltaSize = .defaultSize,
        inline: Bool = true,
        hideArrow: Bool = false,
        loading: Bool = false,
        precision: Int? = nil,
        telemetry: any DeltaTelemetry = OSLogDeltaTelemetry()
    ) {
        let resolved = DeltaInputs(
            metric: metric,
            current: current,
            previous: previous,
            display: display,
            comparedTo: comparedTo,
            size: size,
            inline: inline,
            hideArrow: hideArrow,
            loading: loading,
            precision: precision
        )
        inputs = resolved
        _model = State(initialValue: DeltaModel(inputs: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input,
    /// pre-bound unit preferences).
    public init(model: DeltaModel) {
        inputs = model.inputs
        _model = State(initialValue: model)
    }

    public var body: some View {
        DeltaContentView(projection: model.projection, inline: model.inline)
            .onAppear {
                model.update(units: units)
                model.start()
            }
            .onDisappear { model.stop() }
            .onChange(of: inputs) { _, newInputs in
                model.update(newInputs)
            }
            .onChange(of: units) { _, newUnits in
                model.update(units: newUnits)
            }
    }
}
