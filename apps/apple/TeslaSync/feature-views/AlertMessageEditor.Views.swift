//
//  AlertMessageEditor.Views.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The input chrome for the message-template editor: the include-title checkbox row (web `Checkbox`
//  + `HelpIcon`), the inline help affordance (web `HelpIcon`), the label row (web label + hint +
//  `HelpIcon` + "Pick a preset"), and the multi-line template field (web `Textarea`) wired to the
//  iOS-18 `TextSelection` so the model can track the caret for the `{{`-trigger autocomplete. All
//  copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Inline help affordance (web HelpIcon)

/// A small "?" affordance that surfaces the field help on tap (web `HelpIcon` tooltip). The help text
/// is also exposed as the accessibility hint so VoiceOver announces it without opening the popover.
struct AlertEditorHelpButton: View {
    let content: String
    @State private var isPresented = false

    var body: some View {
        Button { isPresented = true } label: {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(AlertMessageEditorStrings.text("alertEditor.helpLabel", "Help"))
        .accessibilityHint(Text(verbatim: content))
        .popover(isPresented: $isPresented) {
            Text(verbatim: content)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .padding(TSSpacing.md)
                .frame(maxWidth: 260)
                .presentationCompactAdaptation(.popover)
        }
    }
}

// MARK: - Include-title row (web Checkbox + HelpIcon)

/// The include-title checkbox (web `Checkbox`) with the help affordance. Unchecked → body-only
/// transports deliver no title (the web rule the help text explains).
struct IncludeTitleRow: View {
    @Binding var includeTitle: Bool
    let disabled: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button { includeTitle.toggle() } label: {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: includeTitle ? "checkmark.square.fill" : "square")
                        .font(.system(size: 16))
                        .foregroundStyle(includeTitle ? Color.TS.accent : Color.TS.textMuted)
                        .accessibilityHidden(true)
                    AlertMessageEditorStrings.text(
                        "alertEditor.includeTitleLabel",
                        "Include title in notifications"
                    )
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                }
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel(
                AlertMessageEditorStrings.text("alertEditor.includeTitleLabel", "Include title in notifications")
            )
            .accessibilityValue(Text(includeTitle ? "On" : "Off"))
            .accessibilityAddTraits(includeTitle ? [.isButton, .isSelected] : .isButton)
            AlertEditorHelpButton(content: AlertMessageEditorStrings.string(
                "alertEditor.includeTitleHelp",
                "When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. " +
                    "WebPush, email, and Pushover always include a title."
            ))
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Label row (web label + hint + HelpIcon + "Pick a preset")

/// The template field's label row: the uppercase label, the `{{`-hint, the help affordance, and the
/// trailing "Pick a preset" button (web ghost `Button` with the sparkles icon).
struct TemplateLabelRow: View {
    let label: String
    let help: String
    let disabled: Bool
    let onPickPreset: () -> Void

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            AlertMessageEditorStrings.text("alertEditor.messageTemplateHint", "Type {{ to insert a value")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            AlertEditorHelpButton(content: help)
            Spacer(minLength: TSSpacing.sm)
            pickPresetButton
        }
    }

    private var pickPresetButton: some View {
        TSButton(variant: .ghost, size: .small, action: onPickPreset) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
                AlertMessageEditorStrings.text("alertEditor.presetButton", "Pick a preset")
            }
        }
        .disabled(disabled)
        .accessibilityLabel(AlertMessageEditorStrings.text("alertEditor.presetButton", "Pick a preset"))
    }
}

// MARK: - Template field (web Textarea + caret tracking for the {{ trigger)

/// The multi-line template field (web `Textarea`, `rows={3}`, `maxLength={1024}`). Binds the body +
/// the iOS-18 `TextSelection` so the model can resolve the caret for the autocomplete trigger, and
/// routes arrow / return / escape keys to the autocomplete when it is open.
struct TemplateEditorField: View {
    @Bindable var model: AlertMessageEditorModel
    @State private var selection: TextSelection?
    @FocusState private var focused: Bool

    private var minHeight: CGFloat {
        CGFloat(AlertMessageEditorConfig.editorRows) * 22 + TSSpacing.md
    }

    var body: some View {
        TextEditor(text: templateBinding, selection: $selection)
            .focused($focused)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .scrollContentBackground(.hidden)
            .frame(minHeight: minHeight)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .disabled(model.disabled)
            .onChange(of: selection) { _, sel in
                model.updateCaret(AlertEditorCaret.offset(in: model.template, selection: sel))
            }
            .onChange(of: model.caretRequestVersion) { _, _ in applyCaretRequest() }
            .onKeyPress(.upArrow) { route { model.moveCursorUp() } }
            .onKeyPress(.downArrow) { route { model.moveCursorDown() } }
            .onKeyPress(.return) { route { model.insertHighlightedToken() } }
            .onKeyPress(.tab) { route { model.insertHighlightedToken() } }
            .onKeyPress(.escape) { route { model.closeAutocomplete() } }
            .accessibilityLabel(Text(verbatim: model.labelText))
            .accessibilityValue(Text(verbatim: model.template))
    }

    private var templateBinding: Binding<String> {
        Binding(
            get: { model.template },
            set: { model.setTemplate($0, caret: AlertEditorCaret.offset(in: $0, selection: selection)) }
        )
    }

    /// Routes a key to the autocomplete only while it is open; otherwise lets the field handle it.
    private func route(_ action: () -> Void) -> KeyPress.Result {
        guard model.isAutocompleteOpen else { return .ignored }
        action()
        return .handled
    }

    private func applyCaretRequest() {
        guard let offset = model.caretRequest else { return }
        let index = model.template.index(
            model.template.startIndex,
            offsetBy: min(max(offset, 0), model.template.count)
        )
        selection = TextSelection(insertionPoint: index)
        model.consumeCaretRequest()
    }
}

// MARK: - Caret offset helper (TextSelection → character offset)

/// Converts an iOS-18 `TextSelection` into a character offset for the model's `{{`-trigger logic.
enum AlertEditorCaret {
    static func offset(in text: String, selection: TextSelection?) -> Int {
        guard let selection else { return text.count }
        switch selection.indices {
        case let .selection(range):
            return text.distance(from: text.startIndex, to: range.upperBound)
        case let .multiSelection(ranges):
            guard let last = ranges.ranges.last else { return text.count }
            return text.distance(from: text.startIndex, to: last.upperBound)
        @unknown default:
            return text.count
        }
    }
}
