//
//  IncidentForm.Views.swift
//  TeslaSync — P4 feature view · 0246 · IncidentForm (Apple)
//
//  The composed subviews for the IncidentForm surface: the i18n SwiftUI bridge
//  (`IFView`), the labeled-field wrapper (web `<label>` + control), the title / severity /
//  status / affected-components / initial-message fields (web `<Input>` / `<Select>` /
//  `<Textarea>`), the actions bar (web Cancel + primary "Log incident"/"Logging…"), and
//  the transient toast banner (web `useToast`). Every user-facing string routes through
//  the P1/S10 facade; every interactive element carries a VoiceOver label; colors/spacing
//  come from the P1/S9 tokens — no Tailwind ported.
//

import SwiftUI

// MARK: - SwiftUI i18n helpers (web `t(key, default)`)

/// Bridges the `IncidentFormStrings` facade into the SwiftUI text types the shared
/// components expect, so no view holds a hardcoded literal and runtime-resolved strings
/// flow into `LocalizedStringKey`-typed component parameters verbatim.
enum IFView {
    /// A `LocalizedStringKey` that renders an already-resolved string verbatim.
    static func key(_ resolved: String) -> LocalizedStringKey {
        "\(resolved)"
    }

    /// A `LocalizedStringKey` for a descriptor, resolved through the facade.
    static func key(_ descriptor: LocalizedText) -> LocalizedStringKey {
        key(IncidentFormStrings.string(descriptor))
    }

    /// A verbatim `Text` for a descriptor, resolved through the facade.
    static func text(_ descriptor: LocalizedText) -> Text {
        Text(verbatim: IncidentFormStrings.string(descriptor))
    }

    /// The raw resolved string for a descriptor (a11y labels).
    static func string(_ descriptor: LocalizedText) -> String {
        IncidentFormStrings.string(descriptor)
    }
}

// MARK: - Tone → design-system color (web `toast` variant)

extension IncidentFormTone {
    /// The status token the tone renders as (mirrors `TSTone`, kept local so the Adapter
    /// projection stays view-free + Sendable).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Labeled field wrapper (web `<label>` + optional muted note)

/// A field label row — the web `<label>` with an optional muted note span (web
/// `<span className="text-[var(--text-muted)]">(optional)</span>`), followed by the
/// control. Keeps the title / components / message fields consistent and accessible.
struct IncidentLabeledField<Content: View>: View {
    let label: LocalizedText
    var note: LocalizedText?
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                TSLabel(IFView.key(label))
                if let note {
                    IFView.text(note)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .accessibilityElement(children: .combine)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Title field (web required `<Input maxLength={200} autoFocus>`)

struct IncidentTitleField: View {
    @Bindable var model: IncidentFormModel
    var focus: FocusState<IncidentFormField?>.Binding

    var body: some View {
        IncidentLabeledField(label: IncidentFormText.titleLabel) {
            TSTextField(IFView.key(IncidentFormText.titlePrompt), text: titleBinding)
                .focused(focus, equals: .title)
                .submitLabel(.done)
                .accessibilityLabel(IFView.text(IncidentFormText.titleLabel))
        }
    }

    private var titleBinding: Binding<String> {
        Binding(get: { model.title }, set: { model.setTitle($0) })
    }
}

// MARK: - Severity + Status selects (web 2-col `<Select>` grid)

struct IncidentSeverityStatusFields: View {
    @Bindable var model: IncidentFormModel

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                severity
                statusField
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                severity
                statusField
            }
        }
    }

    private var severity: some View {
        TSSelect(
            selection: severityBinding,
            options: severityOptions,
            label: IFView.key(IncidentFormText.severityLabel)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(IFView.text(IncidentFormText.severityLabel))
    }

    private var statusField: some View {
        TSSelect(
            selection: statusBinding,
            options: statusOptions,
            label: IFView.key(IncidentFormText.statusLabel)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(IFView.text(IncidentFormText.statusLabel))
    }

    private var severityOptions: [TSSelectOption<IncidentSeverity>] {
        IncidentSeverity.allCases.map { TSSelectOption($0, IFView.key(IncidentFormText.severity($0))) }
    }

    private var statusOptions: [TSSelectOption<IncidentStatus>] {
        IncidentStatus.allCases.map { TSSelectOption($0, IFView.key(IncidentFormText.status($0))) }
    }

    private var severityBinding: Binding<IncidentSeverity> {
        Binding(get: { model.severity }, set: { model.severity = $0 })
    }

    private var statusBinding: Binding<IncidentStatus> {
        Binding(get: { model.status }, set: { model.status = $0 })
    }
}

// MARK: - Affected components (web optional `<Input>`)

struct IncidentComponentsField: View {
    @Bindable var model: IncidentFormModel
    var focus: FocusState<IncidentFormField?>.Binding

    var body: some View {
        IncidentLabeledField(label: IncidentFormText.componentsLabel, note: IncidentFormText.componentsNote) {
            TSTextField(IFView.key(IncidentFormText.componentsPrompt), text: $model.components)
                .focused(focus, equals: .components)
                .accessibilityLabel(IFView.text(IncidentFormText.componentsLabel))
        }
    }
}

// MARK: - Initial message (web optional `<Textarea rows={3} maxLength={4000}>`)

struct IncidentMessageField: View {
    @Bindable var model: IncidentFormModel
    var focus: FocusState<IncidentFormField?>.Binding

    var body: some View {
        IncidentLabeledField(label: IncidentFormText.messageLabel, note: IncidentFormText.messageNote) {
            TSTextArea(text: messageBinding, minHeight: 84)
                .focused(focus, equals: .message)
                .accessibilityLabel(IFView.text(IncidentFormText.messageLabel))
        }
    }

    private var messageBinding: Binding<String> {
        Binding(get: { model.message }, set: { model.setMessage($0) })
    }
}

// MARK: - Actions bar (web `flex justify-end gap-2`: Cancel + primary submit)

struct IncidentActionsBar: View {
    @Bindable var model: IncidentFormModel
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                cancelButton
                submitButton
            }
            VStack(spacing: TSSpacing.sm) {
                submitButton
                cancelButton
            }
        }
    }

    private var cancelButton: some View {
        TSButton(variant: .ghost, size: .medium, action: onCancel) {
            IFView.text(IncidentFormText.cancel)
        }
        .disabled(model.isSubmitDisabled)
        .accessibilityLabel(IFView.text(IncidentFormText.cancel))
        .accessibilityHint(IFView.text(IncidentFormText.cancelHint))
        .accessibilityIdentifier(IncidentFormAccessibility.cancelID)
    }

    private var submitButton: some View {
        let label = model.submitLabel
        return TSButton(
            variant: .primary,
            size: .medium,
            action: onSubmit,
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.isSubmitting {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                            .accessibilityHidden(true)
                    }
                    IFView.text(label)
                }
            }
        )
        .disabled(model.isSubmitDisabled)
        .accessibilityLabel(IFView.text(label))
        .accessibilityHint(IFView.text(IncidentFormText.submitHint))
        .accessibilityIdentifier(IncidentFormAccessibility.submitID)
    }
}

// MARK: - Toast banner (web `useToast`)

/// The transient feedback banner — the native counterpart of the web `toast.success` /
/// `toast.error`. Tone-colored, dismissible, and self-clearing via the surface's timed
/// task. Covers the validation, success, offline, and generic-failure branches.
struct IncidentToastView: View {
    let toast: IncidentFormToast
    let onDismiss: () -> Void

    var body: some View {
        let tint = toast.tone.color
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: toast.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: toast.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(IFView.text(IncidentFormText.dismiss))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.3), lineWidth: 1)
        )
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}
