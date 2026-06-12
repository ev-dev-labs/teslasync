//
//  RangeSlider.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The public API of the dual-thumb range slider — the SwiftUI parity of `components/ui/RangeSlider.tsx`.
//  Like the web component it is driven entirely by its props (`value`, `min`, `max`, `step`, `label`, the
//  required `onChange`, the optional `formatValue`, the optional per-thumb a11y overrides, `showLabel`, and
//  `disabled`); there is no fetcher. The view binds through ``RangeSliderModel`` for the thumb interaction +
//  the once-only `view.opened` telemetry (P1/S11), composes the token-driven chrome (P1/S9), honors Reduce
//  Motion at the fill / thumb boundary, and pushes prop changes into the holder via `.onChange` so a reused
//  / re-bound slider re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The dual-thumb range slider — the SwiftUI parity of `components/ui/RangeSlider.tsx`. Renders an optional
/// label / value row over a track with two independently draggable, VoiceOver-adjustable thumbs; dragging
/// one thumb past the other swaps them (web `handleLowChange` / `handleHighChange`). Controlled: the page
/// owns `value` and receives every change through `onChange`. Mount it wherever a user picks a `[low, high]`
/// span (price, distance, date, SoC window, …). A degenerate range (`max <= min`) renders a friendly
/// affordance rather than an unusable track.
public struct RangeSlider: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        RangeSliderSurface.slug
    }

    private let input: RangeSliderInput
    private let onChange: (@MainActor (Double, Double) -> Void)?
    private let formatValue: (@MainActor (Double) -> String)?
    @State private var model: RangeSliderModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<RangeSlider value min max step onChange label
    /// formatValue minThumbLabel maxThumbLabel showLabel disabled />`. The `value` tuple is normalized so
    /// `low <= high`; `onChange` is required (the web component is always controlled).
    public init(
        value: (Double, Double),
        min: Double,
        max: Double,
        step: Double = RangeSliderProjector.defaultStep,
        label: String,
        showLabel: Bool = true,
        disabled: Bool = false,
        minThumbLabel: String? = nil,
        maxThumbLabel: String? = nil,
        formatValue: (@MainActor (Double) -> String)? = nil,
        telemetry: any RangeSliderTelemetry = OSLogRangeSliderTelemetry(),
        onChange: @escaping @MainActor (Double, Double) -> Void
    ) {
        let resolved = RangeSliderInput(
            low: value.0,
            high: value.1,
            min: min,
            max: max,
            step: step,
            label: label,
            showLabel: showLabel,
            isDisabled: disabled,
            minThumbLabel: minThumbLabel,
            maxThumbLabel: maxThumbLabel
        )
        input = resolved
        self.onChange = onChange
        self.formatValue = formatValue
        _model = State(initialValue: RangeSliderModel(
            input: resolved,
            onChange: onChange,
            formatValue: formatValue,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded value).
    public init(
        model: RangeSliderModel,
        formatValue: (@MainActor (Double) -> String)? = nil
    ) {
        input = model.input
        onChange = nil
        self.formatValue = formatValue
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.projection.showsLabelRow {
                RangeSliderLabelRow(
                    label: model.input.label,
                    valueText: "\(model.displayLow) – \(model.displayHigh)",
                    accessibilitySummary: model.valueSummary
                )
            }
            if model.projection.hasRange {
                RangeSliderTrack(model: model, reduceMotion: reduceMotion)
            } else {
                RangeSliderEmptyState()
            }
        }
        .opacity(model.projection.isDisabled ? 0.6 : 1)
        .disabled(model.projection.isDisabled)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onChange: onChange, formatValue: formatValue)
        }
    }
}
