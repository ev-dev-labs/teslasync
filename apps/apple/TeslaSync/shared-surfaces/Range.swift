//
//  Range.swift
//  TeslaSync — P4 shared surface · 0087 · Range (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Range.tsx`: the "primary range" renderer that
//  respects BOTH the user's distance-unit preference (km vs mi, web `useUnits()`) and the user's
//  rated-vs-ideal `rangeType` preference (web `useSettings().rangeType`). It selects the preferred
//  range from the supplied state, formats it through the SI distance formatter, and renders it — or
//  the em-dash sentinel when the selected range is missing. The companion `RangeLabel` is the parity
//  of the `useRangeLabel` hook: the localized "Rated Range" / "Ideal Range" label, rendered separately
//  so a stat tile can place the label and value in different elements.
//
//  Naming. The public view is `RangeReadout`, not `Range`: a module-level type named `Range` would
//  shadow `Swift.Range` and break the `Range<Int>` usages in sibling surfaces. This mirrors the web
//  source renaming its `Number` formatter export to `FormattedNumber` to avoid the JS `Number` clash —
//  the file keeps the surface name (`Range.*`) while the symbol is disambiguated.
//
//  The active preferences are read from the environment — `\.tsUnits` (the native parity of
//  `useUnits()`, shared with the sibling SI formatters) and `\.tsRangeType` (the native parity of
//  `useSettings().rangeType`, defined below). The view binds the `RangeModel` state-holder (P1/S8) for
//  the resolved projection and the once-only `view.opened` telemetry (P1/S11); no networking lives in
//  the view. The model is re-synced whenever the props or either preference change
//  (`onChange(initial:)`), the parity of the web component re-rendering.
//

import SwiftUI

// MARK: - Range-type preference environment (web `useSettings().rangeType`)

private struct TSRangeTypeKey: EnvironmentKey {
    static let defaultValue: RangeType = .rated
}

public extension EnvironmentValues {
    /// The active rated-vs-ideal range preference used by the range renderer — the native parity of
    /// `useSettings().rangeType`. Defaults to `.rated`, matching the web `selectPreferredRange`
    /// fallback and the backend default.
    var tsRangeType: RangeType {
        get { self[TSRangeTypeKey.self] }
        set { self[TSRangeTypeKey.self] = newValue }
    }
}

public extension View {
    /// Injects the rated-vs-ideal range preference for the range renderer.
    func tsRangeType(_ rangeType: RangeType) -> some View {
        environment(\.tsRangeType, rangeType)
    }
}

// MARK: - Primary range value (web `Range`)

/// The preferred-range renderer — the SwiftUI parity of the web `Range`. Reads the active unit + range
/// preferences from the environment, projects the value/empty branch through `RangeModel`, and voices
/// the settled figure to VoiceOver. Colour + font are inherited so callers style the figure at the
/// use-site with the P1/S9 tokens.
public struct RangeReadout: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RangeMeta.surfaceSlug

    private let state: RangeState?
    private let precision: Int?

    @Environment(\.tsUnits) private var units
    @Environment(\.tsRangeType) private var rangeType
    @State private var model: RangeModel

    /// Designated initializer — adopts a fully-formed input snapshot and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests). Used when the caller already holds the
    /// active preferences; the convenience initializer reads them from the environment instead.
    public init(
        input: RangeInput,
        telemetry: any RangeTelemetry = OSLogRangeTelemetry()
    ) {
        state = input.state
        precision = input.precision
        _model = State(initialValue: RangeModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Range state={…} precision={0} />`. The active units + range preference are read from the
    /// environment; the model is seeded with the environment defaults and re-synced on first
    /// appearance so the injected preferences are reflected before the figure is shown.
    public init(
        state: RangeState?,
        precision: Int = 0,
        telemetry: any RangeTelemetry = OSLogRangeTelemetry()
    ) {
        self.state = state
        self.precision = precision
        _model = State(initialValue: RangeModel(
            input: RangeInput(state: state, precision: precision, rangeType: .rated, units: .metric),
            telemetry: telemetry
        ))
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: currentInput, initial: true) { _, newInput in model.sync(newInput) }
    }

    /// The current input snapshot derived from the props + the active environment preferences — the
    /// value the model reasons over and the `onChange` key that re-syncs it when either changes.
    private var currentInput: RangeInput {
        RangeInput(state: state, precision: precision, rangeType: rangeType, units: units)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case let .value(value):
            RangeValueView(value: value)
        case let .empty(empty):
            RangeEmptyView(empty: empty)
        }
    }
}

// MARK: - Companion label (web `useRangeLabel`)

/// The localized "Rated Range" / "Ideal Range" label — the SwiftUI parity of the `useRangeLabel` hook.
/// The label depends only on the rated-vs-ideal preference (not on the field values), so it renders a
/// stable label even while the range value is still loading. Reads `\.tsRangeType` from the
/// environment unless an explicit preference is supplied. Presentational only: the `RangeReadout`
/// value view owns the surface's `view.opened` emission, so this companion emits no telemetry.
public struct RangeLabel: View {
    private let explicitRangeType: RangeType?

    @Environment(\.tsRangeType) private var envRangeType

    /// Renders the label for the supplied preference, or the active `\.tsRangeType` environment value
    /// when `rangeType` is `nil`.
    public init(rangeType: RangeType? = nil) {
        explicitRangeType = rangeType
    }

    public var body: some View {
        let resolvedType = explicitRangeType ?? envRangeType
        RangeLabelView(label: RangeProjection.label(for: resolvedType))
    }
}
