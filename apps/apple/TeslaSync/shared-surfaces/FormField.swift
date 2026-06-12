//
//  FormField.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  The form-field wrapper surface — the SwiftUI parity of components/forms/FormField.tsx.
//  Composes the label row, the caller's control, and the single inline message
//  (error / hint / none), binding through `FormFieldModel` (P1/S8). No networking
//  lives in the view; the resolved state is recomputed by the pure projection.
//
//  The web component is an intentionally tiny, presentational wrapper: it renders a
//  required label, a control slot, and exactly one of an error (`role="alert"`) or a
//  hint, or nothing. It fetches nothing (its only hook is `useId`), so this surface
//  reproduces those branches rather than a data lifecycle — the loading / empty /
//  stale / offline chrome is owned by the host form, as it is on the web. The label
//  and control always render (no hidden surface); only the message row is conditional.
//

import SwiftUI

/// The form-field wrapper surface. Generic over the control it wraps so any native
/// input (a `TextField`, a `Picker`, a custom composite) drops into the slot, the
/// way the web `children` prop accepts any control.
public struct FormField<Control: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        FormFieldSurface.slug
    }

    @State private var model: FormFieldModel
    @State private var generatedID = UUID().uuidString
    private let control: () -> Control

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Binds an externally-owned model (e.g. a host form's live field state).
    public init(model: FormFieldModel, @ViewBuilder control: @escaping () -> Control) {
        _model = State(initialValue: model)
        self.control = control
    }

    /// Convenience for a field whose label / hint / error are known at the call site
    /// (the common static case). Mirrors the web prop list 1:1.
    public init(
        label: String,
        required: Bool = false,
        hint: String? = nil,
        error: String? = nil,
        fieldID: String? = nil,
        telemetry: any FormFieldTelemetry = OSLogFormFieldTelemetry(),
        @ViewBuilder control: @escaping () -> Control
    ) {
        let input = FormFieldInput(
            label: label,
            required: required,
            hint: hint,
            error: error,
            fieldID: fieldID
        )
        let model = FormFieldModel(
            source: InMemoryFormFieldSource(initial: input),
            initial: input,
            telemetry: telemetry
        )
        _model = State(initialValue: model)
        self.control = control
    }

    /// The id used to tag the field for UI tests / label association — the caller's
    /// `htmlFor` when supplied, else a stable generated id (web `useId`).
    private var fieldID: String {
        model.resolved.fieldID ?? generatedID
    }

    public var body: some View {
        let resolved = model.resolved
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FormFieldLabelView(
                label: resolved.label,
                isRequired: resolved.isRequired,
                requiredWord: FormFieldStrings.requiredWord()
            )
            control()
            FormFieldMessageView(message: resolved.message)
                .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: resolved.message)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: resolved.message) { _, newValue in
            announceIfError(newValue)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(fieldID)
    }

    /// Web `role="alert"` parity: when the message becomes an error, post an
    /// accessibility announcement so VoiceOver surfaces the validation text as it
    /// appears rather than only on next focus.
    private func announceIfError(_ message: FormFieldMessage) {
        guard case let .error(text) = message else { return }
        AccessibilityNotification.Announcement(text).post()
    }
}
