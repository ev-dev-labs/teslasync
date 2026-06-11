//
//  FeedbackModal.Controls.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The form controls for `FeedbackModal`, kept apart from the scaffold for the lint length budget:
//  the single-line title field (web `<Input>`), the multi-line details field (web `<Textarea>`), the
//  shared field chrome, and the auto-attached-context panel — the consent surface that lists the
//  page route + app version + client identity (web `page_route` / `app_version` / `user_agent`) and
//  the two attach toggles (recent errors, default ON; recent console messages, default OFF), phase-
//  switched so it shows loading / empty / error before the rows. Copy via P1/S10; chrome via P1/S9.
//

import SwiftUI

// MARK: - Field chrome (shared surface + border, red when errored)

/// The shared field chrome: token surface, rounded border tinted red on error (web `Input` error
/// ring). Local to the surface so it does not depend on the private `TSFieldChrome`.
struct FeedbackFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

// MARK: - Title field (web single-line `<Input maxLength=120>`)

/// A labelled single-line text field with a length cap + inline error (web `<Input>`). The visible
/// label sits above; the control's accessibility name is the field label. `onBlur` marks the field
/// touched (web `handleBlur`) so its error only appears after the user leaves it.
struct FeedbackTextField: View {
    @Binding var text: String
    let label: String
    let prompt: String
    let maxLength: Int
    let errorMessage: String?
    let onBlur: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FeedbackFieldLabel(text: label)
            TextField(text: $text, prompt: Text(verbatim: prompt)) {
                Text(verbatim: label)
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .focused($focused)
            .modifier(FeedbackFieldChrome(hasError: errorMessage != nil))
            .accessibilityLabel(Text(verbatim: label))
            .onChange(of: text) { _, newValue in
                if newValue.count > maxLength { text = String(newValue.prefix(maxLength)) }
            }
            .onChange(of: focused) { wasFocused, isFocused in
                if wasFocused, !isFocused { onBlur() }
            }
            if let errorMessage {
                Text(verbatim: errorMessage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
    }
}

// MARK: - Details field (web multi-line `<Textarea rows=6 maxLength=4000>`)

/// A labelled multi-line text field with a length cap + inline error (web `<Textarea>`), backed by a
/// `TextEditor` sized for ~6 rows.
struct FeedbackTextArea: View {
    @Binding var text: String
    let label: String
    let prompt: String
    let maxLength: Int
    let errorMessage: String?
    let onBlur: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FeedbackFieldLabel(text: label)
            editor
            if let errorMessage {
                Text(verbatim: errorMessage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityAddTraits(.isStaticText)
            }
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(verbatim: prompt)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.sm + 4)
                    .padding(.vertical, TSSpacing.sm + 8)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 132)
                .focused($focused)
                .modifier(FeedbackFieldChrome(hasError: errorMessage != nil))
                .accessibilityLabel(Text(verbatim: label))
                .onChange(of: text) { _, newValue in
                    if newValue.count > maxLength { text = String(newValue.prefix(maxLength)) }
                }
                .onChange(of: focused) { wasFocused, isFocused in
                    if wasFocused, !isFocused { onBlur() }
                }
        }
    }
}

// MARK: - Auto-attached-context panel (web "Auto-attached context")

/// The consent surface (web "Auto-attached context" box): a caption, then the diagnostics rows + the
/// two attach toggles for `.content`, else the loading / empty / error envelopes so the section is
/// never a blank box. The form above always stays usable regardless of this panel's phase.
struct FeedbackContextPanel: View {
    @Bindable var model: FeedbackModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            FeedbackStrings.text("feedback.context.title", "Auto-attached context")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            body(for: model.contextPhase)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private func body(for phase: FeedbackContextPhase) -> some View {
        switch phase {
        case .loading:
            FeedbackContextLoadingState()
        case .empty:
            FeedbackContextEmptyState()
        case let .error(message):
            FeedbackContextErrorState(message: message) { model.retryContext() }
        case .content:
            FeedbackContextRows(model: model)
        }
    }
}

// MARK: - Context rows + attach toggles (web context list + toggles)

/// The resolved context rows (Page / App version / Browser) plus the two attach toggles, with the
/// inline reload error surfaced above them when a refresh failed while a cached context remains.
struct FeedbackContextRows: View {
    @Bindable var model: FeedbackModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = model.inlineErrorMessage {
                FeedbackInlineError(message: message)
            }
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                FeedbackContextRow(
                    label: FeedbackStrings.string("feedback.context.page", "Page"),
                    value: value(model.context?.pageRoute),
                    monospaced: true
                )
                FeedbackContextRow(
                    label: FeedbackStrings.string("feedback.context.appVersion", "App version"),
                    value: value(model.context?.appVersion),
                    monospaced: true
                )
                FeedbackContextRow(
                    label: FeedbackStrings.string("feedback.context.userAgent", "Browser"),
                    value: value(model.context?.userAgent),
                    monospaced: false
                )
            }
            FeedbackToggleRow(
                label: FeedbackStrings.string(
                    "feedback.form.includeErrors",
                    "Attach recent errors ({{count}})",
                    errorCount: model.recentErrorCount
                ),
                hint: FeedbackStrings.string(
                    "feedback.form.includeErrorsHint",
                    "Includes the most recent uncaught errors from this session. Helps reproduce the bug."
                ),
                isOn: $model.includeRecentErrors
            )
            FeedbackToggleRow(
                label: FeedbackStrings.string("feedback.form.includeConsole", "Attach recent console messages"),
                hint: FeedbackStrings.string(
                    "feedback.form.includeConsoleHint",
                    "Privacy: console output may include URLs and data you saw. Off by default."
                ),
                isOn: $model.includeConsoleTail
            )
        }
    }

    /// The displayed value, falling back to the localized "unknown" (web `value || t('…unknown')`).
    private func value(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? FeedbackStrings.string("feedback.context.unknown", "unknown") : trimmed
    }
}

/// One auto-context row: a bold label and its value (monospaced for the route + version, wrapping for
/// the client-identity string).
struct FeedbackContextRow: View {
    let label: String
    let value: String
    let monospaced: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: "\(label):")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(monospaced ? .system(.caption, design: .monospaced) : Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FeedbackAccessibility.contextRowLabel(label: label, value: value)))
    }
}

// MARK: - Attach toggle row (web `<Toggle>` + `<HelperText>`)

/// One attach toggle with its helper text (web `Toggle` + `HelperText`). The hint is attached to the
/// switch as an accessibility hint and shown below for sighted users.
struct FeedbackToggleRow: View {
    let label: String
    let hint: String
    @Binding var isOn: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Toggle(isOn: $isOn) {
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .tint(Color.TS.accent)
            .accessibilityHint(Text(verbatim: hint))
            Text(verbatim: hint)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
        }
    }
}
