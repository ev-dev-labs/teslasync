//
//  AIProviderSection.Rows.swift
//  TeslaSync — P4 feature view · 0200 · AIProviderSection (Apple)
//
//  The reusable field rows for the AI provider configuration surface — the native
//  peers of the web `<Input>` / `<Select>` / password `<Input>` controls. Each row
//  composes a P1/S9-token label, a native control, and an optional hint, resolving
//  every string through the P1/S10 facade (rendered `verbatim`) so the view holds no
//  hardcoded literals. The validate row reuses the shared `TSButton` (web ghost
//  `<Button>`) and renders the inline status banner (web `<span role="status">`).
//

import SwiftUI

// MARK: - Field chrome (token surface + rounded border)

/// Shared field chrome: token surface clipped to the field radius with the semantic
/// border — the native peer of the web input border treatment.
private struct AiProviderFieldChrome: ViewModifier {
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
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Labeled field container (label + control + hint)

/// Stacks a field label, its control, and an optional helper hint — the native peer
/// of a web labeled `<Input>`/`<Select>`. The visible label + hint are decorative
/// (`accessibilityHidden`); the control owns the spoken label + hint.
struct AiProviderFieldContainer<Control: View>: View {
    let label: String
    var hint: String?
    @ViewBuilder let control: () -> Control

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            control()
            if let hint, !hint.isEmpty {
                Text(verbatim: hint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Text field (web `<Input>` / numeric `<Input type="number">`)

/// A labeled single-line text input — the native peer of the web `<Input>`. The
/// `isNumber` variant drives the decimal keypad on iOS (web `type="number"`).
struct AiProviderTextField: View {
    let label: String
    let prompt: String
    var hint: String?
    var isNumber = false
    @Binding var text: String

    var body: some View {
        AiProviderFieldContainer(label: label, hint: hint) {
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .modifier(AiProviderFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityHint(Text(verbatim: hint ?? ""))
        }
    }

    private var field: some View {
        let base = TextField(text: $text, prompt: Text(verbatim: prompt)) {
            Text(verbatim: label)
        }
        .labelsHidden()
        #if os(iOS)
            return base
                .keyboardType(isNumber ? .decimalPad : .default)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
        #else
            return base
        #endif
    }
}

// MARK: - Secure field (web `<Input type="password">`)

/// A labeled masked input — the native peer of the web password `<Input>`. Values are
/// never echoed; an empty value means "keep the stored key" (the parent handles that).
struct AiProviderSecureField: View {
    let label: String
    let prompt: String
    var hint: String?
    @Binding var text: String

    var body: some View {
        AiProviderFieldContainer(label: label, hint: hint) {
            field
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .modifier(AiProviderFieldChrome())
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityHint(Text(verbatim: hint ?? ""))
        }
    }

    private var field: some View {
        let base = SecureField(text: $text, prompt: Text(verbatim: prompt)) {
            Text(verbatim: label)
        }
        .labelsHidden()
        #if os(iOS)
            return base.textContentType(.newPassword)
        #else
            return base.textContentType(.newPassword)
        #endif
    }
}

// MARK: - Picker field (web `<Select>`)

/// One picker option carrying an already-resolved verbatim title (a brand proper noun
/// or a facade-resolved Azure-flavor label).
struct AiProviderPickerOption: Identifiable, Equatable {
    let value: String
    let title: String

    var id: String {
        value
    }
}

/// A labeled dropdown — the native peer of the web `<Select>`, backed by a menu
/// `Picker`. Titles are rendered `verbatim` (resolved upstream).
struct AiProviderPickerField: View {
    let label: String
    var hint: String?
    @Binding var selection: String
    let options: [AiProviderPickerOption]

    var body: some View {
        AiProviderFieldContainer(label: label, hint: hint) {
            Picker(selection: $selection) {
                ForEach(options) { option in
                    Text(verbatim: option.title).tag(option.value)
                }
            } label: {
                Text(verbatim: label)
            }
            .labelsHidden()
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityHint(Text(verbatim: hint ?? ""))
        }
    }
}

// MARK: - Responsive pair (web `grid sm:grid-cols-2`)

/// Lays two fields side by side on a regular-width idiom and stacked otherwise — the
/// native peer of the web `grid-cols-1 sm:grid-cols-2` field grid.
struct AiProviderFieldPair<First: View, Second: View>: View {
    @ViewBuilder let first: () -> First
    @ViewBuilder let second: () -> Second

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var isWide: Bool {
            horizontalSizeClass == .regular
        }
    #else
        private let isWide = true
    #endif

    var body: some View {
        if isWide {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                first().frame(maxWidth: .infinity, alignment: .leading)
                second().frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            VStack(spacing: TSSpacing.md) {
                first()
                second()
            }
        }
    }
}

// MARK: - Validate row (web ghost `<Button>` + inline `<span role="status">`)

/// The validate action + inline status banner — the shared `TSButton` (web ghost
/// `<Button>`) whose title flips to "Validating…" while a probe runs, beside the
/// success/failure banner with a `role="status"`-equivalent spoken label.
struct AiProviderValidateRow: View {
    let title: String
    let disabled: Bool
    let banner: AiProviderValidateBanner?
    let onValidate: () -> Void

    private var statusA11y: String {
        guard let banner else { return "" }
        let format = AiProviderStrings.string("ai.settings.provider.validateStatusA11y", "Validation status: %@")
        return AiProviderAccessibility.validateStatus(format: format, message: banner.message)
    }

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            TSButton(variant: .ghost, action: onValidate) {
                Text(verbatim: title)
            }
            .disabled(disabled)
            .accessibilityLabel(Text(verbatim: title))
            if let banner {
                Text(verbatim: banner.message)
                    .font(Font.TS.caption)
                    .foregroundStyle(banner.kind == .ok ? Color.TS.statusSuccess : Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(verbatim: statusA11y))
            }
            Spacer(minLength: 0)
        }
    }
}
