//
//  Temperature.swift
//  TeslaSync — P4 shared surface · 0089 · Temperature (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Temperature.tsx`: a presentational renderer
//  that takes a caller temperature in Celsius or Fahrenheit, normalizes it to the SI Celsius base,
//  converts it to the user's preferred temperature unit, formats it with locale-aware grouping at the
//  resolved precision, and appends the unit label with no separating space — exposing the raw caller
//  value as a tooltip. When neither input is a finite number it renders the em-dash sentinel ("—").
//
//  The active unit preference is read from the `\.tsUnits` environment — the native parity of the web
//  `useUnits()` hook (the per-render bridge to the user's settings). The view binds the
//  `TemperatureModel` state-holder (P1/S8) for the resolved projection and the once-only `view.opened`
//  telemetry (P1/S11); no networking lives in the view. The model is re-synced whenever the props or
//  the active units change (`onChange(initial:)`), the parity of the web component re-rendering.
//

import SwiftUI

/// The temperature renderer — the SwiftUI parity of the web `Temperature`. Reads the active unit
/// preference from the environment, projects the value/empty branch through `TemperatureModel`, and
/// voices the settled figure to VoiceOver. Colour + font are inherited so callers style the figure at
/// the use-site with the P1/S9 tokens.
public struct Temperature: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TemperatureMeta.surfaceSlug

    private let celsius: Double?
    private let fahrenheit: Double?
    private let precision: Int?

    @Environment(\.tsUnits) private var units
    @State private var model: TemperatureModel

    /// Designated initializer — adopts a fully-formed input snapshot and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests). Used when the caller already holds the
    /// active `UnitPreferences`; the convenience initializer reads them from the environment instead.
    public init(
        input: TemperatureInput,
        telemetry: any TemperatureTelemetry = OSLogTemperatureTelemetry()
    ) {
        celsius = input.celsius
        fahrenheit = input.fahrenheit
        precision = input.precision
        _model = State(initialValue: TemperatureModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Temperature c={…} f={…} precision={…} />`. The active units are read from the `\.tsUnits`
    /// environment; the model is seeded with the environment default and re-synced on first appearance
    /// so the injected preference is reflected before the figure is shown.
    public init(
        celsius: Double? = nil,
        fahrenheit: Double? = nil,
        precision: Int? = nil,
        telemetry: any TemperatureTelemetry = OSLogTemperatureTelemetry()
    ) {
        self.celsius = celsius
        self.fahrenheit = fahrenheit
        self.precision = precision
        _model = State(initialValue: TemperatureModel(
            input: TemperatureInput(
                celsius: celsius,
                fahrenheit: fahrenheit,
                precision: precision,
                units: .metric
            ),
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
    private var currentInput: TemperatureInput {
        TemperatureInput(celsius: celsius, fahrenheit: fahrenheit, precision: precision, units: units)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case let .value(value):
            TemperatureValueView(value: value)
        case let .empty(empty):
            TemperatureEmptyView(empty: empty)
        }
    }
}
