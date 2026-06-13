//
//  Combobox.Views.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  The field-level subviews composed by `Combobox`: the visible field label (web `<label>`), the
//  editable text field with its leading icon + trailing inline spinner / clear (×) / chevron (web
//  `<input role="combobox">` + adornments), the hardware-keyboard contract (web `handleKeyDown` →
//  `.onKeyPress`), the freshness chip (P4 connectivity axis), and the production polite announcer (web
//  `useAnnouncer` live region). The listbox + its rows live in `Combobox.Listbox.swift`. All chrome is
//  token-driven (P1/S9); all copy resolves through the P1/S10 facade — no raw hex, no Tailwind ports,
//  no English literals.
//

import SwiftUI

// MARK: - Field label (web `<label>`)

/// The visible field label (web `<label>`), shown above the field when `hideLabel` is false. The field
/// itself carries the accessibility label, so this is hidden from VoiceOver to avoid a double read.
struct ComboboxLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityHidden(true)
    }
}

// MARK: - Field chrome (web `Input` surface + focus ring)

/// The token-driven field surface — the native parity of the web combobox input chrome (rounded
/// surface + hairline border, a 2pt accent ring on focus mirroring the web `focus:ring-2`).
private struct ComboboxFieldChrome: ViewModifier {
    let focused: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(focused ? Color.TS.accent : Color.TS.border, lineWidth: focused ? 2 : 1)
            )
    }
}

// MARK: - Inline icon button (web trailing chevron / clear ×)

/// A compact inline icon affordance — the native peer of the web trailing chevron + clear buttons. The
/// glyph is decorative; the button carries the explicit accessibility label and an enlarged hit target.
struct ComboboxIconButton: View {
    let systemName: String
    let label: String
    var rotated = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .rotationEffect(.degrees(rotated ? 180 : 0))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Keyboard contract (web handleKeyDown → .onKeyPress)

/// Wires the web combobox keyboard contract onto the field for hardware keyboards (macOS / iPadOS):
/// ArrowDown / ArrowUp move the active descendant (wrapping), Home / End jump to the ends, and Escape
/// closes without committing. Enter is handled by the field's `onSubmit`.
private struct ComboboxKeyboardModifier: ViewModifier {
    let model: ComboboxModel

    func body(content: Content) -> some View {
        content
            .onKeyPress(.downArrow) { model.moveDown(); return .handled }
            .onKeyPress(.upArrow) { model.moveUp(); return .handled }
            .onKeyPress(.home) { model.moveHome(); return .handled }
            .onKeyPress(.end) { model.moveEnd(); return .handled }
            .onKeyPress(.escape) {
                guard model.isOpen else { return .ignored }
                model.close()
                return .handled
            }
    }
}

// MARK: - Field (web `<input role="combobox">` + adornments)

/// The editable combobox field — a text field bound to the model's query (every keystroke routes
/// through `setQuery`, the web `handleInputChange`), with an optional leading icon and the trailing
/// inline spinner (web async indicator) / clear (×) / chevron toggle. Gaining focus opens the list (web
/// `onFocus`); Enter commits the highlighted option or free text (web Enter); the keyboard contract is
/// attached for hardware keyboards.
struct ComboboxField: View {
    @Bindable var model: ComboboxModel
    @FocusState private var isFocused: Bool

    private var queryBinding: Binding<String> {
        Binding(get: { model.query }, set: { model.setQuery($0) })
    }

    private var promptText: Text? {
        guard let prompt = model.config.prompt, !prompt.isEmpty else { return nil }
        return Text(verbatim: prompt)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            if let icon = model.config.iconSystemName {
                Image(systemName: icon)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            field
            trailing
        }
        .modifier(ComboboxFieldChrome(focused: isFocused))
        .onChange(of: isFocused) { _, focused in
            if focused { model.open() }
        }
    }

    private var field: some View {
        let editor = TextField(text: queryBinding, prompt: promptText) {
            Text(verbatim: model.config.label)
        }
        .textFieldStyle(.plain)
        .font(Font.TS.body)
        .labelsHidden()
        .frame(maxWidth: .infinity, alignment: .leading)
        .focused($isFocused)
        .disabled(model.config.disabled)
        .autocorrectionDisabled(true)
        .onSubmit { model.commitActive() }
        .accessibilityLabel(Text(verbatim: model.config.label))
        .modifier(ComboboxKeyboardModifier(model: model))

        #if os(iOS)
            return editor.textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }

    private var trailing: some View {
        HStack(spacing: TSSpacing.xs) {
            if model.effectiveLoading {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel(Text(verbatim: ComboboxStrings.loading))
            }
            if model.showsClear {
                ComboboxIconButton(systemName: "xmark", label: ComboboxStrings.clearAria) {
                    model.clear()
                }
            }
            if !model.config.noChevron {
                ComboboxIconButton(
                    systemName: "chevron.down",
                    label: model.isOpen ? ComboboxStrings.closeListAria : ComboboxStrings.openListAria,
                    rotated: model.isOpen
                ) {
                    model.toggleOpen()
                }
                .disabled(model.config.disabled)
            }
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the field when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the options, with
/// an explicit label.
struct ComboboxFreshnessChip: View {
    let connection: ComboboxConnection
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
        case .live: ComboboxStrings.live
        case .stale: ComboboxStrings.stale
        case .offline: ComboboxStrings.offline
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: label
        case .stale: ComboboxStrings.staleA11y
        case .offline: ComboboxStrings.offlineA11y
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
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the result-count announcement to the assistive technology via
/// `AccessibilityNotification.Announcement` at `.default` (polite) speech priority — the native parity
/// of the web `useAnnouncer` `aria-live="polite"` region the field writes "5 results" / "No results"
/// into as the user types.
@MainActor
public struct LiveComboboxAnnouncer: ComboboxAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}
