//
//  HelpIcon.swift
//  TeslaSync — P4 shared surface · 0215 · HelpIcon (Apple)
//
//  The public API of the field-level help primitive — the SwiftUI parity of `components/ui/HelpIcon.tsx`.
//  Like the web component it is driven entirely by its props (`i18nKey` / `content` for the help text, the
//  optional `for` field id, the `side` placement, and an `ariaLabel` override); there is no fetcher. It
//  binds through ``HelpIconModel`` for the reveal interaction + the once-only `view.opened` telemetry
//  (P1/S11), resolves its strings through the P1/S10 facade, composes the token-driven chrome (P1/S9), and
//  — faithfully reproducing the web `if (!text) return null` — renders NOTHING when no help text resolves,
//  so adopting call-sites need not gate the icon themselves when a help string is conditionally absent.
//  No networking, no Tailwind ports.
//

import SwiftUI

/// The field-level help primitive — the SwiftUI parity of `components/ui/HelpIcon.tsx`. Renders a tiny
/// `(?)` trigger you place next to a form `<Label>`; tapping it (or, on macOS, hovering) reveals the help
/// copy in a popover. Resolves the help text from `i18nKey` (falling back to `content`) and the trigger's
/// accessibility label from `ariaLabel` ?? ("Help for {field}" when `for` is set, else the generic "More
/// info"). Renders nothing when no help text is supplied — the parity of the web `return null`.
public struct HelpIcon: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        HelpIconSurface.slug
    }

    private let input: HelpIconInput
    @State private var model: HelpIconModel

    /// The prop-style initializer — the parity of `<HelpIcon i18nKey content for side ariaLabel />`. The
    /// help text resolves from `i18nKey` (with `content` as the fallback) or plain `content`; the `side`
    /// places the bubble (web `'left'` / `'right'` fold to `leading` / `trailing`); `ariaLabel` overrides
    /// the trigger label. Supplying neither `i18nKey` nor `content` (or a string that resolves empty) makes
    /// the surface render nothing — the web `if (!text) return null`.
    public init(
        i18nKey: String? = nil,
        content: String? = nil,
        for forID: String? = nil,
        side: HelpIconSide = .defaultSide,
        ariaLabel: String? = nil,
        resolve: @escaping HelpIconResolve = HelpIconStrings.resolve,
        telemetry: any HelpIconTelemetry = OSLogHelpIconTelemetry()
    ) {
        let resolved = HelpIconInput(
            i18nKey: i18nKey,
            content: content,
            forID: forID,
            side: side,
            ariaLabelOverride: ariaLabel
        )
        input = resolved
        _model = State(initialValue: HelpIconModel(input: resolved, resolve: resolve, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a fake resolver, a
    /// seeded presented state).
    public init(model: HelpIconModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.hasContent {
                HelpIconTrigger(model: model)
                    .onAppear { model.start() }
                    .onDisappear { model.stop() }
            }
        }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }
}
