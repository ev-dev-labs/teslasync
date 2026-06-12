//
//  Label.swift
//  TeslaSync — P4 shared surface · 0218 · Label (Apple)
//
//  The SwiftUI surface — the public API of the form label, the parity of the web
//  `<Label required>{children}</Label>`. Like the web component it is driven entirely by its props (`text`
//  — the web `children`; `required`; and the optional `fieldIdentifier` — the web `htmlFor`); there is no
//  fetcher. It renders the label text and, when `required`, a red `*` (hidden from VoiceOver) while the
//  spoken "required" is folded into the accessible name — the native peer of the web visible `aria-hidden`
//  `*` plus the `<VisuallyHidden> required</VisuallyHidden>` (WCAG 3.3.2). The view binds through
//  ``LabelModel`` for the derived projection + the once-only `view.opened` telemetry (P1/S11), composes
//  token-driven chrome (P1/S9), resolves copy through the P1/S10 facade, and pushes prop changes into the
//  holder via `.onChange` so a reused label re-renders faithfully. No networking, no Tailwind ports.
//
//  Named `FormLabel` (not `Label`): `Label` is a SwiftUI built-in used across this module, so a
//  module-level `Label` would shadow it; `FormLabel` also matches the web source's note that this form
//  label is "semantically distinct from" the typography `Label`. The diagnostics slug stays "Label".
//

import SwiftUI

/// The form label — the SwiftUI parity of `components/ui/Label.tsx`. Renders the label text with an
/// optional required marker: a red `*` for sighted users (hidden from VoiceOver) plus the spoken "required"
/// folded into the accessible name, so the paired control reads "<label> required" (WCAG 3.3.2). Place it
/// above or beside a field — wire `fieldIdentifier` (the web `htmlFor`) to the control for association.
public struct FormLabel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        LabelSurface.slug
    }

    private let input: LabelInput
    @State private var model: LabelModel

    /// The prop-style initializer — the parity of `<Label required htmlFor>{text}</Label>`. `text` is the
    /// already-localized caller content (web `children`); `required` is the web `required`; and
    /// `fieldIdentifier` is the web `htmlFor` (the associated control's identifier), surfaced as the native
    /// accessibility identifier.
    public init(
        _ text: String,
        required: Bool = false,
        fieldIdentifier: String? = nil,
        telemetry: any LabelTelemetry = OSLogLabelTelemetry()
    ) {
        let resolved = LabelInput(text: text, isRequired: required, fieldIdentifier: fieldIdentifier)
        input = resolved
        _model = State(initialValue: LabelModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded prop set).
    public init(model: LabelModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        LabelBody(projection: model.projection)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }
}
