import SwiftUI

/// Single-value slider (web `Slider`) with a label + live value readout.
public struct TSSlider: View {
    private let label: LocalizedStringKey
    @Binding private var value: Double
    private let range: ClosedRange<Double>
    private let format: (Double) -> String

    public init(
        _ label: LocalizedStringKey,
        value: Binding<Double>,
        in range: ClosedRange<Double>,
        format: @escaping (Double) -> String = { String(format: "%.0f", $0) }
    ) {
        self.label = label
        _value = value
        self.range = range
        self.format = format
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                TSLabel(label)
                Spacer()
                TSCode(format(value))
            }
            Slider(value: $value, in: range)
                .tint(Color.TS.accent)
                .accessibilityValue(Text(verbatim: format(value)))
        }
    }
}

/// Dual-thumb range selector (web `RangeSlider`).
///
/// Implemented as two native `Slider`s (each fully accessible) clamped so the
/// lower thumb never crosses the upper — a custom-gesture track would be hard to
/// make VoiceOver-correct.
public struct TSRangeSlider: View {
    private let label: LocalizedStringKey
    @Binding private var lowerValue: Double
    @Binding private var upperValue: Double
    private let range: ClosedRange<Double>
    private let format: (Double) -> String

    public init(
        _ label: LocalizedStringKey,
        lowerValue: Binding<Double>,
        upperValue: Binding<Double>,
        in range: ClosedRange<Double>,
        format: @escaping (Double) -> String = { String(format: "%.0f", $0) }
    ) {
        self.label = label
        _lowerValue = lowerValue
        _upperValue = upperValue
        self.range = range
        self.format = format
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                TSLabel(label)
                Spacer()
                TSCode("\(format(lowerValue)) – \(format(upperValue))")
            }
            Slider(
                value: Binding(get: { lowerValue }, set: { lowerValue = min($0, upperValue) }),
                in: range
            )
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("range.lowerBound"))
            .accessibilityValue(Text(verbatim: format(lowerValue)))

            Slider(
                value: Binding(get: { upperValue }, set: { upperValue = max($0, lowerValue) }),
                in: range
            )
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("range.upperBound"))
            .accessibilityValue(Text(verbatim: format(upperValue)))
        }
    }
}
