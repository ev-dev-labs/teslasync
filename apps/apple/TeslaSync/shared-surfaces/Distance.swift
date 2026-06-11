//
//  Distance.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Distance.tsx`: a presentational renderer that
//  takes a caller distance in miles or kilometres, normalizes it to SI metres, converts it to the
//  user's preferred distance unit, formats it with locale-aware grouping at the resolved precision,
//  and appends the unit label — exposing the raw caller value as a tooltip. When neither input is a
//  finite number it renders the em-dash sentinel ("—").
//
//  The active unit preference is read from the `\.tsUnits` environment — the native parity of the web
//  `useUnits()` hook (the per-render bridge to the user's settings). The view binds the `DistanceModel`
//  state-holder (P1/S8) for the resolved projection and the once-only `view.opened` telemetry
//  (P1/S11); no networking lives in the view. The model is re-synced whenever the props or the active
//  units change (`onChange(initial:)`), the parity of the web component re-rendering.
//

import SwiftUI

/// The distance renderer — the SwiftUI parity of the web `Distance`. Reads the active unit preference
/// from the environment, projects the value/empty branch through `DistanceModel`, and voices the
/// settled figure to VoiceOver. Colour + font are inherited so callers style the figure at the
/// use-site with the P1/S9 tokens.
public struct Distance: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DistanceMeta.surfaceSlug

    private let miles: Double?
    private let km: Double?
    private let precision: Int?

    @Environment(\.tsUnits) private var units
    @State private var model: DistanceModel

    /// Designated initializer — adopts a fully-formed input snapshot and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests). Used when the caller already holds the
    /// active `UnitPreferences`; the convenience initializer reads them from the environment instead.
    public init(
        input: DistanceInput,
        telemetry: any DistanceTelemetry = OSLogDistanceTelemetry()
    ) {
        miles = input.miles
        km = input.km
        precision = input.precision
        _model = State(initialValue: DistanceModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Distance miles={…} km={…} precision={…} />`. The active units are read from the `\.tsUnits`
    /// environment; the model is seeded with the environment default and re-synced on first appearance
    /// so the injected preference is reflected before the figure is shown.
    public init(
        miles: Double? = nil,
        km: Double? = nil,
        precision: Int? = nil,
        telemetry: any DistanceTelemetry = OSLogDistanceTelemetry()
    ) {
        self.miles = miles
        self.km = km
        self.precision = precision
        _model = State(initialValue: DistanceModel(
            input: DistanceInput(miles: miles, km: km, precision: precision, units: .metric),
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
    private var currentInput: DistanceInput {
        DistanceInput(miles: miles, km: km, precision: precision, units: units)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case let .value(value):
            DistanceValueView(value: value)
        case let .empty(empty):
            DistanceEmptyView(empty: empty)
        }
    }
}
