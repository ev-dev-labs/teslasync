//
//  FeedbackModal.Views.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  The populated chrome for `FeedbackModal`: the modal header (bug glyph + "Report a bug / Send
//  feedback" title + freshness chip + close), the form scaffold (category selector → title → details
//  → auto-attached-context panel → submit-error alert → footer), the category selector (web
//  `<Select>`), the footer (Cancel + Send-feedback), the field label, and the validation-message
//  helpers. The field + context controls live in `FeedbackModal.Controls.swift`. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: the bug glyph, the title + freshness chip, and the trailing close button (web
/// `Modal` title bar with its `onClose` "×").
struct FeedbackHeader: View {
    let connection: FeedbackConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                FeedbackStrings.text("feedback.title", "Report a bug / Send feedback")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                FeedbackFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "exclamationmark.bubble.fill")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 32, height: 32)
            .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FeedbackStrings.text("feedback.closeAria", "Close"))
    }
}

// MARK: - Form (web populated `<form>`)

/// The populated form: the category selector, the required title field, the required details field,
/// the auto-attached-context panel (loading / empty / error / content), the submit-failure alert, and
/// the footer actions. The form always renders (web parity); only the context panel switches phase.
struct FeedbackForm: View {
    @Bindable var model: FeedbackModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            FeedbackCategorySelector(model: model)
            FeedbackTextField(
                text: $model.title,
                label: FeedbackStrings.string("feedback.form.title.label", "Title"),
                prompt: FeedbackStrings.string(
                    "feedback.form.title.placeholder", // parity:allow web i18n key from FeedbackModal.tsx
                    "Short summary (e.g. \"Battery widget shows NaN\")"
                ),
                maxLength: FeedbackLimits.titleMax,
                errorMessage: feedbackTitleErrorMessage(model.titleError),
                onBlur: model.markTitleTouched
            )
            FeedbackTextArea(
                text: $model.details,
                label: FeedbackStrings.string("feedback.form.body.label", "Details"),
                prompt: FeedbackStrings.string(
                    "feedback.form.body.placeholder", // parity:allow web i18n key from FeedbackModal.tsx
                    "What happened? What did you expect to happen? Steps to reproduce help a lot."
                ),
                maxLength: FeedbackLimits.bodyMax,
                errorMessage: feedbackBodyErrorMessage(model.bodyError),
                onBlur: model.markBodyTouched
            )
            FeedbackContextPanel(model: model)
            if model.submitFailed {
                FeedbackSubmitErrorAlert()
            }
            FeedbackFooter(
                submitting: model.submitting,
                submitDisabled: model.submitDisabled,
                submitLabel: FeedbackAccessibility.submitLabel(submitting: model.submitting, localize: model.localize),
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }
}

// MARK: - Category selector (web `<Select>`)

/// The "What kind of feedback?" selector — the native parity of the web category `<Select>` over a
/// menu `Picker` so all three options (bug / feature / other) read with their glyph + label.
struct FeedbackCategorySelector: View {
    @Bindable var model: FeedbackModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FeedbackFieldLabel(text: FeedbackStrings.string("feedback.form.category.label", "What kind of feedback?"))
            Picker(selection: $model.category) {
                ForEach(model.categoryOptions) { option in
                    Label {
                        Text(verbatim: FeedbackStrings.string(option.labelKey, option.labelFallback))
                    } icon: {
                        Image(systemName: option.systemImage)
                    }
                    .tag(option.category)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(
                FeedbackStrings.text("feedback.form.category.label", "What kind of feedback?")
            )
        }
    }
}

// MARK: - Footer (web Cancel + Send feedback)

/// The form footer: the ghost Cancel and the primary Send-feedback action (web footer row). Cancel is
/// disabled while a submit is in flight; Send is disabled until the form validates and shows
/// "Submitting…" while in flight (web `submitDisabled` + the label swap).
struct FeedbackFooter: View {
    let submitting: Bool
    let submitDisabled: Bool
    let submitLabel: String
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onCancel) {
                Text(verbatim: FeedbackStrings.string("common.cancel", "Cancel"))
            }
            .disabled(submitting)
            .accessibilityLabel(FeedbackStrings.text("common.cancel", "Cancel"))
            TSButton(variant: .primary, size: .small, action: onSubmit) {
                Text(verbatim: submitLabel)
            }
            .disabled(submitDisabled)
            .accessibilityLabel(Text(verbatim: submitLabel))
        }
    }
}

// MARK: - Field label + validation-message helpers

/// A form field's visible label (web `<Input label>` / selector heading), styled as a token label.
struct FeedbackFieldLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The localized message for a title validation error (web zod min/max), or `nil` when valid.
func feedbackTitleErrorMessage(_ error: FeedbackFieldError?) -> String? {
    error.map { value in
        switch value {
        case let .tooShort(min):
            FeedbackStrings.string(
                "feedback.validation.titleMin",
                "Title must be at least {{0}} characters",
                count: min
            )
        case let .tooLong(max):
            FeedbackStrings.string("feedback.validation.titleMax", "Title must be at most {{0}} characters", count: max)
        }
    }
}

/// The localized message for a details validation error (web zod min/max), or `nil` when valid.
func feedbackBodyErrorMessage(_ error: FeedbackFieldError?) -> String? {
    error.map { value in
        switch value {
        case let .tooShort(min):
            FeedbackStrings.string(
                "feedback.validation.bodyMin",
                "Details must be at least {{0}} characters",
                count: min
            )
        case let .tooLong(max):
            FeedbackStrings.string(
                "feedback.validation.bodyMax",
                "Details must be at most {{0}} characters",
                count: max
            )
        }
    }
}
