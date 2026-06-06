import SwiftUI

/// Shared field chrome: token surface, rounded border (red when errored).
private struct TSFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

/// Single-line text input (web `Input`) with optional label + inline error.
public struct TSTextField: View {
    private let prompt: LocalizedStringKey
    @Binding private var text: String
    private let label: LocalizedStringKey?
    private let error: LocalizedStringKey?

    public init(
        _ prompt: LocalizedStringKey,
        text: Binding<String>,
        label: LocalizedStringKey? = nil,
        error: LocalizedStringKey? = nil
    ) {
        self.prompt = prompt
        _text = text
        self.label = label
        self.error = error
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let label { TSLabel(label) }
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .modifier(TSFieldChrome(hasError: error != nil))
            if let error { TSErrorText(error) }
        }
    }
}

/// Masked password input (web `Input type=password`).
public struct TSSecureField: View {
    private let prompt: LocalizedStringKey
    @Binding private var text: String
    private let label: LocalizedStringKey?

    public init(_ prompt: LocalizedStringKey, text: Binding<String>, label: LocalizedStringKey? = nil) {
        self.prompt = prompt
        _text = text
        self.label = label
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let label { TSLabel(label) }
            SecureField(prompt, text: $text)
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .modifier(TSFieldChrome(hasError: false))
        }
    }
}

/// Multi-line text input (web `Textarea`).
public struct TSTextArea: View {
    @Binding private var text: String
    private let label: LocalizedStringKey?
    private let minHeight: CGFloat

    public init(text: Binding<String>, label: LocalizedStringKey? = nil, minHeight: CGFloat = 96) {
        _text = text
        self.label = label
        self.minHeight = minHeight
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if let label { TSLabel(label) }
            TextEditor(text: $text)
                .font(Font.TS.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: minHeight)
                .modifier(TSFieldChrome(hasError: false))
        }
    }
}

/// Custom checkbox (web `Checkbox`) — native SF Symbol toggle with a11y traits.
public struct TSCheckbox: View {
    private let label: LocalizedStringKey
    @Binding private var isOn: Bool

    public init(_ label: LocalizedStringKey, isOn: Binding<Bool>) {
        self.label = label
        _isOn = isOn
    }

    public var body: some View {
        Button {
            isOn.toggle()
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .foregroundStyle(isOn ? Color.TS.accent : Color.TS.textMuted)
                    .imageScale(.large)
                Text(label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? [.isButton, .isSelected] : .isButton)
    }
}

/// Switch control (web `Toggle`).
public struct TSToggle: View {
    private let label: LocalizedStringKey
    @Binding private var isOn: Bool

    public init(_ label: LocalizedStringKey, isOn: Binding<Bool>) {
        self.label = label
        _isOn = isOn
    }

    public var body: some View {
        Toggle(isOn: $isOn) {
            Text(label).font(Font.TS.body)
        }
        .tint(Color.TS.accent)
    }
}
