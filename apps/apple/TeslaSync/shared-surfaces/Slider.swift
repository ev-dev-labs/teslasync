//
//  Slider.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  The single-thumb slider surface — the SwiftUI parity of `components/ui/Slider.tsx`. The web
//  component wraps a controlled `<input type="range">`: a required `label` that doubles as the
//  accessible name, an optional `showLabel` row with a live `formatValue` readout, `min` / `max` /
//  `step` bounds, a `disabled` flag, and an `onChange(value)` callback fired on every change. This
//  surface reproduces that primitive with the idiomatic native `Slider`, binding through `SliderModel`
//  (P1/S8) for the canonical value + the once-only `view.opened` telemetry (P1/S11); no networking
//  lives in the view.
//
//  Naming. The public view is `SliderField`, not `Slider`: a module-level type named `Slider` would
//  shadow `SwiftUI.Slider` and break the native track this surface (and its siblings) compose — the
//  same disambiguation the sibling `RangeReadout` (0087) and `CurrencyInputField` (0150) surfaces
//  apply. The file keeps the surface name (`Slider.*`) and the diagnostics slug stays "Slider".
//
//  States. The web source is a controlled primitive with no data fetch (`useId` is id generation, not
//  a query), so there is no loading / error / stale / offline axis — the track always renders. The
//  genuine branches reproduced are the optional label row (`showLabel`) and the disabled track. See
//  Slider.Adapter for the full parity note.
//

import SwiftUI

// MARK: - SliderField (the shared surface)

/// The single-thumb slider surface — the SwiftUI parity of `components/ui/Slider.tsx`. Renders the
/// optional label + readout row and the native track, binding through `SliderModel`.
public struct SliderField: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = SliderMeta.surfaceSlug

    /// The value-type input snapshot — the `onChange(of:)` key that re-syncs the model when the host
    /// re-renders with a changed prop (the parity of a controlled re-render).
    private let input: SliderInput

    @State private var model: SliderModel

    /// Designated initializer mirroring the web prop signature — the parity of mounting
    /// `<Slider value={…} min={…} max={…} step={…} label={…} formatValue={…} showLabel={…}
    /// disabled={…} id={…} onChange={…} />`. `format` is the unit-aware `formatValue` (the readout +
    /// the spoken value); when omitted the raw number is shown (web `String(value)`). `telemetry` is
    /// injectable for tests; the production default logs `view.opened`.
    public init(
        value: Double,
        minimum: Double,
        maximum: Double,
        step: Double = SliderMeta.defaultStep,
        label: String,
        format: ((Double) -> String)? = nil,
        showLabel: Bool = true,
        isDisabled: Bool = false,
        id: String? = nil,
        telemetry: any SliderTelemetry = OSLogSliderTelemetry(),
        onChange: @escaping (Double) -> Void
    ) {
        let snapshot = SliderInput(
            value: value,
            minimum: minimum,
            maximum: maximum,
            step: step,
            label: label,
            showLabel: showLabel,
            isDisabled: isDisabled,
            identifier: SliderMeta.makeIdentifier(id)
        )
        input = snapshot
        _model = State(initialValue: SliderModel(
            input: snapshot,
            format: format,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Idiomatic SwiftUI convenience — drives a `Binding<Double>` instead of a controlled
    /// `value` + `onChange` pair. Commits write back through the binding (the native parity of the web
    /// parent owning the value and re-rendering).
    public init(
        value: Binding<Double>,
        minimum: Double,
        maximum: Double,
        step: Double = SliderMeta.defaultStep,
        label: String,
        format: ((Double) -> String)? = nil,
        showLabel: Bool = true,
        isDisabled: Bool = false,
        id: String? = nil,
        telemetry: any SliderTelemetry = OSLogSliderTelemetry()
    ) {
        self.init(
            value: value.wrappedValue,
            minimum: minimum,
            maximum: maximum,
            step: step,
            label: label,
            format: format,
            showLabel: showLabel,
            isDisabled: isDisabled,
            id: id,
            telemetry: telemetry,
            onChange: { value.wrappedValue = $0 }
        )
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if model.resolved.showLabel {
                SliderLabelRow(
                    labelText: model.resolved.labelText,
                    displayText: model.resolved.displayText
                )
            }
            SliderTrackView(
                resolved: model.resolved,
                value: Binding(get: { model.value }, set: { model.setValue($0) }),
                onCommand: { model.apply($0) }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input, initial: true) { _, newInput in model.sync(newInput) }
        .accessibilityElement(children: .contain)
    }
}
