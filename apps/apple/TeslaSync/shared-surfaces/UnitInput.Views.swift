//
//  UnitInput.Views.swift
//  TeslaSync — P4 shared surface · 0162 · UnitInput (Apple)
//
//  The presentational subviews composed by `UnitInputField`: the editable number field (the web
//  `<Input>` with its trailing unit-symbol suffix, decimal keypad, focus-protected text buffer, and
//  commit-on-blur / commit-on-Enter), the labelled "ready" body with the "not set" hint for the empty
//  value, and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Field chrome (web `Input` surface + hairline border)

/// The token-driven field surface — the native parity of the web `Input` chrome (rounded surface
/// with a hairline border), kept local because the shared text-field chrome modifier is private.
private struct UnitInputFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Editable field (web `<Input>` + trailing symbol + focus guard)

/// The number field itself — a decimal text field bound to the model's focus-protected buffer with a
/// trailing unit-symbol suffix (the web `suffix`, accessibility-hidden). Focus begins editing (the
/// web `onFocus`), losing focus commits + renormalises (the web `onBlur`), and Enter commits while
/// keeping focus (the web `onKeyDown` Enter). The field carries the web `label` as its accessibility
/// label, is decimal on iOS, and respects the disabled flag.
struct UnitInputFieldEditor: View {
    @Bindable var model: UnitInputFieldModel
    let resolved: UnitInputFieldResolved
    @FocusState private var isFocused: Bool

    private var prompt: String {
        UnitInputFieldStrings.string("unitInput.prompt", "Value")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            field
            if !resolved.symbol.isEmpty {
                Text(verbatim: resolved.symbol)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .modifier(UnitInputFieldChrome())
        .onChange(of: isFocused) { _, focused in
            if focused {
                model.beginEditing()
            } else {
                model.commitEditing()
            }
        }
    }

    private var field: some View {
        let editor = TextField(text: $model.editingText, prompt: Text(verbatim: prompt)) {
            Text(verbatim: resolved.label)
        }
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .monospacedDigit()
        .labelsHidden()
        .frame(maxWidth: .infinity, alignment: .leading)
        .focused($isFocused)
        .disabled(resolved.isDisabled)
        .autocorrectionDisabled(true)
        .onSubmit { model.submit() }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))

        #if os(iOS)
            return editor
                .keyboardType(.decimalPad)
                .textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }

    /// The composed VoiceOver label — the field label plus the current value or the empty hint, so
    /// the spoken content never lands on a bare number or an unlabeled control.
    private var accessibilityLabel: String {
        UnitInputFieldAccessibility.fieldLabel(
            label: resolved.label,
            value: model.editingText,
            emptyHint: UnitInputFieldStrings.string("unitInput.notSet", "Not set")
        )
    }
}

// MARK: - Ready body (the web editable field, labelled, never a blank box)

/// The `ready` render — the (always-present) labelled number field with the web `label` shown as the
/// visible field label, a required marker when set, and a "not set" hint beneath the field when the
/// value is empty (the P4 "never a blank box" treatment of the web blank value). Wrapped in the
/// shared fade-in for entrance polish.
struct UnitInputFieldReadyView: View {
    @Bindable var model: UnitInputFieldModel
    let resolved: UnitInputFieldResolved

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                label
                UnitInputFieldEditor(model: model, resolved: resolved)
                if resolved.isEmptyValue {
                    Text(verbatim: UnitInputFieldStrings.string("unitInput.notSet", "Not set"))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var label: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: resolved.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if resolved.isRequired {
                Text(verbatim: "*")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the field when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct UnitInputFieldFreshnessChip: View {
    let connection: UnitInputFieldConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: UnitInputFieldStrings.string("unitInput.live", "Live")
        case .stale: UnitInputFieldStrings.string("unitInput.stale", "Stale")
        case .offline: UnitInputFieldStrings.string("unitInput.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            UnitInputFieldStrings.string("unitInput.staleA11y", "Stale — tap to refresh")
        case .offline:
            UnitInputFieldStrings.string("unitInput.offlineA11y", "Offline — showing the last saved value")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
