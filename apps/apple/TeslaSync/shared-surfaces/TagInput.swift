//
//  TagInput.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  The public API of the free-text tag chip input — the SwiftUI parity of `components/forms/TagInput.tsx`.
//  Like the web component it is a CONTROLLED field driven by its props (`value`, `onChange`, `label`,
//  field-prompt, `maxTags`, `separators`, `disabled`, `lowercase`, `hint`, `validateTag`); the field owns
//  only the in-progress text + a validation error. The view binds through ``TagInputModel`` for the
//  once-only `view.opened` telemetry (P1/S11), the commit / removal logic, and the polite add / remove
//  announcements (web live region); composes the token-driven chrome (P1/S9); and reproduces every state
//  — the parent's loading / error / connectivity (the P4 leaf axis, as the sibling CurrencyInput) plus the
//  ready field's empty / populated / at-cap / invalid branches. No networking, no Tailwind ports.
//
//  States (every one renders — no hidden surface):
//    • loading  — the bound value's fetch in flight → skeleton field.
//    • ready    — the editable field; renders empty (with a "No tags yet" hint) OR populated (chips), at
//                 the cap (input disabled + cap hint), or with a validation error beneath — never blank.
//    • error    — the parent's value fetch failed → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the field with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TagInput (the shared surface)

/// The free-text tag chip input — the SwiftUI parity of `components/forms/TagInput.tsx`. Renders a chip
/// per committed tag with a remove button, a typing field that commits on Enter / separator / blur,
/// Backspace-removes-last, optional `maxTags` cap + per-tag validation, plus the P4 leaf states. Binds
/// through ``TagInputModel`` (P1/S8); no networking lives here.
public struct TagInput: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = TagInputMeta.surfaceSlug

    @State private var model: TagInputModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8 source
    /// through it; previews + tests inject an in-memory source).
    public init(model: TagInputModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting `<TagInput
    /// value={…} onChange={…} label={…} maxTags={…} … />`. Wires a `LiveTagInputSource` over the value
    /// snapshot and forwards commits to `onChange`.
    public init(
        tags: [String],
        label: String,
        hideLabel: Bool = false,
        prompt: String? = nil,
        maxTags: Int? = nil,
        separators: [TagSeparator] = TagInputMeta.defaultSeparators,
        lowercase: Bool = false,
        disabled: Bool = false,
        hint: String? = nil,
        validateTag: ((String) -> String?)? = nil,
        telemetry: any TagInputTelemetry = OSLogTagInputTelemetry(),
        announcer: any TagInputAnnouncer = LiveTagInputAnnouncer(),
        onChange: @escaping @MainActor ([String]) -> Void
    ) {
        let input = TagInputSnapshot(
            tags: tags,
            label: label,
            hideLabel: hideLabel,
            prompt: prompt,
            maxTags: maxTags,
            separators: separators,
            lowercase: lowercase,
            disabled: disabled,
            hint: hint
        )
        let source = LiveTagInputSource(value: input, onCommit: onChange)
        _model = State(initialValue: TagInputModel(
            source: source,
            validate: validateTag,
            telemetry: telemetry,
            announcer: announcer
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            content
            if model.connection != .live {
                TagInputFreshnessChip(connection: model.connection) {
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
            TagInputLoadingView()
        case let .error(message):
            TagInputErrorView(message: message) { model.refresh() }
        case .ready:
            TagInputReadyView(model: model, resolved: model.resolved)
        }
    }
}
