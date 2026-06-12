//
//  EditableText.Views.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The presentational pieces of the inline-edit primitive — the native peers of the web elements: the
//  production announcer (the web `useAnnouncer` polite live region fired after a save), the display
//  surface (the web button-styled-as-text + the hover-revealed pencil, or the muted/italic
//  prompt / "Not set" leaf for an empty value), the edit surface (the web `<input>` with its
//  bordered chrome, the in-flight spinner, the commit-on-Enter / commit-on-blur / Escape-to-cancel
//  behaviour, and the inline error), the labelled "ready" body, and the freshness chip (P4 connectivity
//  axis). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports. Decorative glyphs are hidden
//  from VoiceOver; the display button + the input both carry the web `aria-label`.
//

import SwiftUI

// MARK: - Production announcer (posts a real polite announcement)

/// Posts the announcement to the assistive technology via SwiftUI's `AccessibilityNotification`
/// `.Announcement` at `.default` (polite) speech priority — the native parity of the web `announce(...)`
/// `aria-live="polite"` region the field writes the "{label} saved" message into on a successful commit.
@MainActor
public struct LiveEditableTextFieldAnnouncer: EditableTextFieldAnnouncer {
    public init() {}

    public func announce(_ message: String) {
        guard !message.isEmpty else { return }
        var attributed = AttributedString(message)
        attributed.accessibilitySpeechAnnouncementPriority = .default
        AccessibilityNotification.Announcement(attributed).post()
    }
}

// MARK: - Variant font (web `text-sm font-normal` vs `text-base font-semibold`)

/// Maps the web `variant` to the design-system font role — `body` → the 14pt regular body role,
/// `heading` → the 16pt semibold panel role (P1/S9 tokens).
enum EditableTextFieldVariantFont {
    static func font(_ variant: EditableTextFieldVariant) -> Font {
        switch variant {
        case .body: Font.TS.body
        case .heading: Font.TS.panel
        }
    }
}

// MARK: - Field chrome (web `Input` surface + hairline border that reddens on error)

/// The token-driven field surface — the native parity of the web input chrome (rounded surface with a
/// hairline border that turns danger-red on a validation / save error, web `border-rose-400`), kept local
/// because the shared `TSTextField` chrome modifier is private.
private struct EditableTextFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Display surface (web button-styled-as-text + pencil)

/// The display state — the native peer of the web default `<button>` styled as text: the visible value
/// (or the muted/italic prompt / "Not set" leaf for an empty value) followed by a pencil affordance
/// when editable. Tapping enters edit mode (the web `onClick` / `onDoubleClick`); the button is a single
/// VoiceOver element carrying the web `aria-label` + an edit hint, and is inert when `disabled`.
struct EditableTextFieldDisplayView: View {
    let resolved: EditableTextFieldResolved
    let onStartEdit: () -> Void

    private var font: Font {
        EditableTextFieldVariantFont.font(resolved.variant)
    }

    var body: some View {
        Button(action: onStartEdit) {
            HStack(spacing: TSSpacing.xs) {
                text
                if !resolved.isDisabled {
                    Image(systemName: "pencil")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, TSSpacing.xs / 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(resolved.isDisabled)
        .accessibilityLabel(Text(verbatim: resolved.ariaLabel))
        .accessibilityValue(Text(verbatim: accessibilityValue))
        .accessibilityHint(Text(verbatim: resolved.isDisabled ? "" : EditableTextFieldStrings.editHint))
    }

    @ViewBuilder
    private var text: some View {
        switch resolved.displayContent {
        case let .value(value):
            Text(verbatim: value)
                .font(font)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        case let .prompt(prompt):
            Text(verbatim: prompt)
                .font(font)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        case .notSet:
            Text(verbatim: EditableTextFieldStrings.notSet)
                .font(font)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    /// The spoken value — the saved text, or the prompt / "Not set" leaf for an empty value, so
    /// VoiceOver reads the same content the eye sees. Uses the shared engine mapping so the spoken text
    /// stays in lock-step with the rendered content.
    private var accessibilityValue: String {
        EditableTextFieldEngine.displayText(
            content: resolved.displayContent,
            notSet: EditableTextFieldStrings.notSet
        )
    }
}

// MARK: - Edit surface (web `<input>` + spinner + inline error)

/// The edit state — the native peer of the web `<input>`: a text field bound to the model's clamped,
/// live-validated draft, autofocused on entry, committing on Enter (web `onKeyDown` Enter) and on focus
/// loss (web `onBlur`, only when valid + not saving), cancelling on Escape (web Escape). An in-flight
/// commit shows a trailing spinner and disables the field (web `disabled={saving}`); a validation /
/// save error reddens the border and shows an inline message beneath (web `ErrorText`).
struct EditableTextFieldEditView: View {
    @Bindable var model: EditableTextFieldModel
    let resolved: EditableTextFieldResolved
    @FocusState private var isFocused: Bool

    private var font: Font {
        EditableTextFieldVariantFont.font(resolved.variant)
    }

    private var draftBinding: Binding<String> {
        Binding(get: { model.draft }, set: { model.updateDraft($0) })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                field
                if model.isSaving {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel(Text(verbatim: EditableTextFieldStrings.saving))
                }
            }
            .modifier(EditableTextFieldChrome(hasError: model.errorText != nil))
            if let error = model.errorText {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { isFocused = true }
        .onChange(of: isFocused) { _, focused in
            guard !focused else { return }
            if model.shouldCommitOnBlur() {
                Task { await model.commitDraft() }
            }
        }
    }

    private var field: some View {
        let editor = TextField(text: draftBinding, prompt: prompt) {
            Text(verbatim: resolved.ariaLabel)
        }
        .textFieldStyle(.plain)
        .font(font)
        .labelsHidden()
        .focused($isFocused)
        .disabled(model.isSaving)
        .autocorrectionDisabled(true)
        .onSubmit { Task { await model.commitDraft() } }
        .onKeyPress(.escape) {
            model.cancelEdit()
            return .handled
        }
        .accessibilityLabel(Text(verbatim: resolved.ariaLabel))
        .accessibilityValue(Text(verbatim: model.draft))

        #if os(iOS)
            return editor.textInputAutocapitalization(.sentences)
        #else
            return editor
        #endif
    }

    private var prompt: Text? {
        resolved.inputPrompt.isEmpty ? nil : Text(verbatim: resolved.inputPrompt)
    }
}

// MARK: - Ready body (display ⇄ edit, never a blank box)

/// The `ready` render — the (always-present) inline-edit field. It shows the edit surface while editing
/// and the display surface otherwise, wrapped in the shared fade-in for entrance polish. The surface
/// always renders (display or edit, empty or populated), so it is never a blank box.
struct EditableTextFieldReadyView: View {
    @Bindable var model: EditableTextFieldModel
    let resolved: EditableTextFieldResolved

    var body: some View {
        TSFadeIn {
            Group {
                if model.isEditing {
                    EditableTextFieldEditView(model: model, resolved: resolved)
                } else {
                    EditableTextFieldDisplayView(resolved: resolved) {
                        model.startEdit()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the field when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot, with
/// an explicit label.
struct EditableTextFieldFreshnessChip: View {
    let connection: EditableTextFieldConnection
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
        case .live: EditableTextFieldStrings.live
        case .stale: EditableTextFieldStrings.stale
        case .offline: EditableTextFieldStrings.offline
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live: label
        case .stale: EditableTextFieldStrings.staleA11y
        case .offline: EditableTextFieldStrings.offlineA11y
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
