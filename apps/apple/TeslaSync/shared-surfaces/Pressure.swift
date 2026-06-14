//
//  Pressure.swift
//  TeslaSync — P4 shared surface · 0086 · Pressure (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Pressure.tsx`: a presentational renderer that
//  takes a caller pressure in bar or psi, normalizes it to SI kilopascals, converts it to the user's
//  preferred pressure unit, formats it with locale-aware grouping at the resolved precision, and
//  appends the unit label — exposing the raw caller value as a tooltip. When neither input is a finite
//  number it renders the em-dash sentinel ("—").
//
//  The active unit preference is read from the `\.tsUnits` environment — the native parity of the web
//  `useUnits()` hook (the per-render bridge to the user's settings). The view binds the `PressureModel`
//  state-holder (P1/S8) for the resolved projection and the once-only `view.opened` telemetry
//  (P1/S11); no networking lives in the view. The model is re-synced whenever the props or the active
//  units change (`onChange(initial:)`), the parity of the web component re-rendering.
//

import SwiftUI

/// The pressure renderer — the SwiftUI parity of the web `Pressure`. Reads the active unit preference
/// from the environment, projects the value/empty branch through `PressureModel`, and voices the
/// settled figure to VoiceOver. Colour + font are inherited so callers style the figure at the
/// use-site with the P1/S9 tokens.
public struct Pressure: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PressureMeta.surfaceSlug

    private let bar: Double?
    private let psi: Double?
    private let precision: Int?

    @Environment(\.tsUnits) private var units
    @State private var model: PressureModel

    /// Designated initializer — adopts a fully-formed input snapshot and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests). Used when the caller already holds the
    /// active `UnitPreferences`; the convenience initializer reads them from the environment instead.
    public init(
        input: PressureInput,
        telemetry: any PressureTelemetry = OSLogPressureTelemetry()
    ) {
        bar = input.bar
        psi = input.psi
        precision = input.precision
        _model = State(initialValue: PressureModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Pressure bar={…} psi={…} precision={…} />`. The active units are read from the `\.tsUnits`
    /// environment; the model is seeded with the environment default and re-synced on first appearance
    /// so the injected preference is reflected before the figure is shown.
    public init(
        bar: Double? = nil,
        psi: Double? = nil,
        precision: Int? = nil,
        telemetry: any PressureTelemetry = OSLogPressureTelemetry()
    ) {
        self.bar = bar
        self.psi = psi
        self.precision = precision
        _model = State(initialValue: PressureModel(
            input: PressureInput(bar: bar, psi: psi, precision: precision, units: .metric),
            telemetry: telemetry
        ))
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: currentInput, initial: true) { _, newInput in model.sync(newInput) }
    }

    /// The current input snapshot derived from the props + the active environment units — the value
    /// the model reasons over and the `onChange` key that re-syncs it when either changes.
    private var currentInput: PressureInput {
        PressureInput(bar: bar, psi: psi, precision: precision, units: units)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case let .value(value):
            PressureValueView(value: value)
        case let .empty(empty):
            PressureEmptyView(empty: empty)
        }
    }
}
