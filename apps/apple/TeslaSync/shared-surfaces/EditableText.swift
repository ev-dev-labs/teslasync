//
//  EditableText.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The inline-edit primitive surface — the SwiftUI parity of `components/ui/EditableText.tsx`. The web
//  component replaces "open a modal to rename" flows with a faster double-click (or Enter / F2) → input →
//  Enter-to-save / Escape-to-cancel pattern: a display state (a button styled as text plus a pencil) and
//  an edit state (a text field with an in-flight spinner and an inline error) bound to a controlled
//  `value` + an asynchronous `onSave(next): Promise<void>`. This surface reproduces that field and adds
//  the P4 leaf states (loading / error / stale / offline) so it never collapses to a blank box. It binds
//  through ``EditableTextFieldModel`` (P1/S8); no networking lives here.
//
//  Type-name note: the component-library bundle already owns a module-public `TSEditableText` atomic
//  view, so this surface's view is named ``EditableTextField`` (the precedent set by the CurrencyInput
//  surface vs. the `Currency` display type); the diagnostics slug stays "EditableText".
//
//  States (every one renders — no hidden surface):
//    • loading  — the bound value's fetch in flight → skeleton field.
//    • ready    — the editable field; display (value / prompt / "Not set" / disabled) ⇄ edit (idle /
//                 saving / validation-error / save-failure). Always renders, empty or populated.
//    • error    — the parent's fetch failed → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the field with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - EditableTextField (the shared surface)

/// The inline-edit primitive — the SwiftUI parity of `components/ui/EditableText.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through ``EditableTextFieldModel``.
public struct EditableTextField: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = EditableTextFieldMeta.surfaceSlug

    @State private var model: EditableTextFieldModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8 source +
    /// the validator through it; previews + tests inject an in-memory source).
    public init(model: EditableTextFieldModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<EditableText value={…} ariaLabel={…} onSave={…} validate={…} prompt maxLength variant
    /// disabled />`. Wires a ``LiveEditableTextFieldSource`` over the value snapshot, forwards commits to
    /// the async `onSave`, and posts the post-save announcement through ``LiveEditableTextFieldAnnouncer``.
    public init(
        value: String,
        ariaLabel: String,
        prompt: String? = nil,
        maxLength: Int? = nil,
        variant: EditableTextFieldVariant = .body,
        isDisabled: Bool = false,
        validate: ((String) -> String?)? = nil,
        telemetry: any EditableTextFieldTelemetry = OSLogEditableTextFieldTelemetry(),
        announcer: any EditableTextFieldAnnouncer = LiveEditableTextFieldAnnouncer(),
        onSave: @escaping @MainActor (String) async throws -> Void
    ) {
        let input = EditableTextFieldInput(
            value: value,
            ariaLabel: ariaLabel,
            prompt: prompt,
            maxLength: maxLength,
            variant: variant,
            isDisabled: isDisabled
        )
        let source = LiveEditableTextFieldSource(value: input, onSave: onSave)
        _model = State(initialValue: EditableTextFieldModel(
            source: source,
            validate: validate,
            telemetry: telemetry,
            announcer: announcer
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                EditableTextFieldFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.phase {
        case .loading:
            EditableTextFieldLoadingView()
        case let .error(message):
            EditableTextFieldErrorView(message: message) { model.refresh() }
        case .ready:
            EditableTextFieldReadyView(model: model, resolved: model.resolved)
        }
    }
}
