import SwiftUI

/// One removable active-filter chip.
public struct TSFilterChip: Identifiable {
    public let id: String
    public let label: LocalizedStringKey

    public init(id: String, label: LocalizedStringKey) {
        self.id = id
        self.label = label
    }
}

/// Removable active-filter chips (web `ActiveFilterChips`).
public struct TSActiveFilterChips: View {
    private let chips: [TSFilterChip]
    private let onRemove: (TSFilterChip) -> Void
    private let onClearAll: (() -> Void)?

    public init(chips: [TSFilterChip], onRemove: @escaping (TSFilterChip) -> Void, onClearAll: (() -> Void)? = nil) {
        self.chips = chips
        self.onRemove = onRemove
        self.onClearAll = onClearAll
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(chips) { chip in
                    HStack(spacing: TSSpacing.xs) {
                        Text(chip.label).font(Font.TS.caption)
                        Button { onRemove(chip) } label: {
                            Image(systemName: "xmark").font(.caption2)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("action.remove"))
                    }
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, 2)
                    .background(Color.TS.accent.opacity(0.12), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
                }
                if !chips.isEmpty, let onClearAll {
                    Button("filter.clearAll", action: onClearAll)
                        .buttonStyle(.plain)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

/// A date preset chip.
public struct TSDatePreset: Identifiable {
    public let id: String
    public let label: LocalizedStringKey

    public init(id: String, label: LocalizedStringKey) {
        self.id = id
        self.label = label
    }
}

/// Date-range preset chips (web `DatePresetChips`).
public struct TSDatePresetChips: View {
    @Binding private var selection: String?
    private let presets: [TSDatePreset]

    public init(selection: Binding<String?>, presets: [TSDatePreset]) {
        _selection = selection
        self.presets = presets
    }

    public var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(presets) { preset in
                let isSelected = selection == preset.id
                Button {
                    selection = isSelected ? nil : preset.id
                } label: {
                    Text(preset.label)
                        .font(Font.TS.caption)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.vertical, TSSpacing.xs)
                        .background(isSelected ? Color.TS.accent : Color.TS.surface, in: Capsule())
                        .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
                        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: isSelected ? 0 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

/// From/to date range filter (web `DateRangeFilter`).
public struct TSDateRangeFilter: View {
    @Binding private var start: Date
    @Binding private var end: Date

    public init(start: Binding<Date>, end: Binding<Date>) {
        _start = start
        _end = end
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSDatePickerBridge("filter.from", date: $start)
            TSDatePickerBridge("filter.to", date: $end)
        }
    }
}

/// Numeric range picker (web `RangePicker`) over the accessible range slider.
public struct TSRangePicker: View {
    private let label: LocalizedStringKey
    @Binding private var lower: Double
    @Binding private var upper: Double
    private let range: ClosedRange<Double>

    public init(
        _ label: LocalizedStringKey,
        lower: Binding<Double>,
        upper: Binding<Double>,
        in range: ClosedRange<Double>
    ) {
        self.label = label
        _lower = lower
        _upper = upper
        self.range = range
    }

    public var body: some View {
        TSRangeSlider(label, lowerValue: $lower, upperValue: $upper, in: range)
    }
}

/// Horizontal scrolling filter container (web `FilterBar`).
public struct TSFilterBar<Content: View>: View {
    private let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                content()
            }
            .padding(.vertical, TSSpacing.xs)
        }
    }
}

/// A pill option for `TSPillFilterBar`.
public struct TSPillOption<Value: Hashable>: Identifiable {
    public let value: Value
    public let label: LocalizedStringKey
    public var id: Value {
        value
    }

    public init(_ value: Value, label: LocalizedStringKey) {
        self.value = value
        self.label = label
    }
}

/// Single-select pill bar (web `PillFilterBar`).
public struct TSPillFilterBar<Value: Hashable>: View {
    @Binding private var selection: Value
    private let options: [TSPillOption<Value>]

    public init(selection: Binding<Value>, options: [TSPillOption<Value>]) {
        _selection = selection
        self.options = options
    }

    public var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(options) { option in
                    let isSelected = option.value == selection
                    Button {
                        selection = option.value
                    } label: {
                        Text(option.label)
                            .font(Font.TS.caption)
                            .fontWeight(isSelected ? .semibold : .regular)
                            .padding(.horizontal, TSSpacing.md)
                            .padding(.vertical, TSSpacing.xs)
                            .background(isSelected ? Color.TS.accent : Color.TS.surface, in: Capsule())
                            .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
                            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: isSelected ? 0 : 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
                }
            }
        }
    }
}

/// A vehicle option for the vehicle selectors.
public struct TSVehicleOption: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    public let nameText: String

    public init(id: String, name: LocalizedStringKey, nameText: String) {
        self.id = id
        self.name = name
        self.nameText = nameText
    }

    var comboOption: TSComboOption<String> {
        TSComboOption(id, title: name, searchText: nameText)
    }
}

/// Single vehicle picker (web `VehicleSelect`).
public struct TSVehicleSelect: View {
    @Binding private var selection: String?
    private let vehicles: [TSVehicleOption]

    public init(selection: Binding<String?>, vehicles: [TSVehicleOption]) {
        _selection = selection
        self.vehicles = vehicles
    }

    public var body: some View {
        TSCombobox(selection: $selection, options: vehicles.map(\.comboOption), prompt: "vehicle.selectPrompt")
    }
}

/// Multi vehicle picker (web `VehicleMultiSelect`).
public struct TSVehicleMultiSelect: View {
    @Binding private var selection: Set<String>
    private let vehicles: [TSVehicleOption]

    public init(selection: Binding<Set<String>>, vehicles: [TSVehicleOption]) {
        _selection = selection
        self.vehicles = vehicles
    }

    public var body: some View {
        TSComboboxMulti(selection: $selection, options: vehicles.map(\.comboOption), prompt: "vehicle.selectPrompt")
    }
}
