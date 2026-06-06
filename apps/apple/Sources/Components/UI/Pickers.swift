import SwiftUI

/// One option in a `TSSelect`.
public struct TSSelectOption<Value: Hashable>: Identifiable {
    public let value: Value
    public let title: LocalizedStringKey
    public var id: Value {
        value
    }

    public init(_ value: Value, _ title: LocalizedStringKey) {
        self.value = value
        self.title = title
    }
}

/// Dropdown select (web `Select`) backed by a native menu `Picker`.
public struct TSSelect<Value: Hashable>: View {
    private let label: LocalizedStringKey?
    @Binding private var selection: Value
    private let options: [TSSelectOption<Value>]

    public init(
        selection: Binding<Value>,
        options: [TSSelectOption<Value>],
        label: LocalizedStringKey? = nil
    ) {
        _selection = selection
        self.options = options
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let label { TSLabel(label) }
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(option.title).tag(option.value)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
        }
    }
}

/// Generic menu trigger (web `DropdownMenu`) wrapping a native `Menu`.
public struct TSPickerMenu<Label: View, Content: View>: View {
    private let label: () -> Label
    private let content: () -> Content

    public init(@ViewBuilder label: @escaping () -> Label, @ViewBuilder content: @escaping () -> Content) {
        self.label = label
        self.content = content
    }

    public var body: some View {
        Menu(content: content, label: label)
    }
}

/// Integer stepper (web numeric `Stepper`).
public struct TSStepper: View {
    private let label: LocalizedStringKey
    @Binding private var value: Int
    private let range: ClosedRange<Int>
    private let step: Int

    public init(_ label: LocalizedStringKey, value: Binding<Int>, in range: ClosedRange<Int>, step: Int = 1) {
        self.label = label
        _value = value
        self.range = range
        self.step = step
    }

    public var body: some View {
        Stepper(value: $value, in: range, step: step) {
            HStack {
                TSLabel(label)
                Spacer()
                TSCode("\(value)")
            }
        }
    }
}

/// Date/time picker (web date input) over the native `DatePicker`.
public struct TSDatePickerBridge: View {
    private let label: LocalizedStringKey
    @Binding private var date: Date
    private let components: DatePickerComponents

    public init(
        _ label: LocalizedStringKey,
        date: Binding<Date>,
        components: DatePickerComponents = [.date]
    ) {
        self.label = label
        _date = date
        self.components = components
    }

    public var body: some View {
        DatePicker(selection: $date, displayedComponents: components) {
            TSLabel(label)
        }
        .tint(Color.TS.accent)
    }
}

/// App appearance choices for `TSThemePicker`.
public enum TSAppearance: String, CaseIterable, Identifiable {
    case system, light, dark

    public var id: String {
        rawValue
    }

    public var titleKey: LocalizedStringKey {
        switch self {
        case .system: "appearance.system"
        case .light: "appearance.light"
        case .dark: "appearance.dark"
        }
    }

    /// The SwiftUI color scheme to force, or `nil` to follow the system.
    public var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

/// Appearance selector (web `ThemeToggle`) as a segmented control.
public struct TSThemePicker: View {
    @Binding private var selection: TSAppearance

    public init(selection: Binding<TSAppearance>) {
        _selection = selection
    }

    public var body: some View {
        Picker(selection: $selection) {
            ForEach(TSAppearance.allCases) { appearance in
                Text(appearance.titleKey).tag(appearance)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.segmented)
    }
}
