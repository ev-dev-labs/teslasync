//
//  MaskedValue.swift
//  TeslaSync — P4 shared surface · 0220 · MaskedValue (Apple)
//
//  The public API of the click-to-reveal privacy primitive — the SwiftUI parity of
//  components/ui/MaskedValue.tsx. Like the web component it is driven entirely by its props (`value`,
//  `variant`, `showLast`, `copyable`, `auditOnReveal`, `ariaLabel`, `autoHideMs`); there is no fetcher.
//  It renders a sensitive string masked by default with a click-to-reveal toggle so the cleartext is
//  occasionally available for copy/paste or visual confirmation but is never shown to a casual
//  screen-share viewer. The view binds through ``MaskedValueModel`` for the runtime `revealed` state, the
//  auto-hide timer, the fire-and-forget reveal-audit (P1/S8), and the once-only `view.opened` telemetry
//  (P1/S11); it composes the token-driven chrome via ``MaskedValueContainer`` (P1/S9), and pushes prop
//  changes into the holder via `.onChange` so a reused control re-renders faithfully. No networking and
//  no Tailwind ports live in the view.
//

import SwiftUI

/// The click-to-reveal privacy primitive — the SwiftUI parity of `components/ui/MaskedValue.tsx`. Renders
/// a sensitive string in its variant-masked form with an eye toggle to reveal/hide it (auto-hiding after
/// `autoHideMs`) and an optional copy button that always copies the raw value. An empty value renders an
/// em-dash with no toggle. Reusable wherever a token, VIN, coordinate, e-mail, or other secret is shown.
public struct MaskedValue: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = MaskedValueSurface.slug

    private let input: MaskedValueInput
    @State private var model: MaskedValueModel

    /// The prop-style initializer — the parity of `<MaskedValue value variant showLast copyable
    /// auditOnReveal ariaLabel autoHideMs />`. `value` is the raw secret (`nil`/empty renders the em-dash);
    /// `variant` selects the masking rule; `showLast` overrides the variant default; `copyable` adds the
    /// copy button; `auditOnReveal` records each reveal through `auditRecorder`; `ariaLabel` is the
    /// required semantic description (never the raw secret); `autoHideMs` is the reveal auto-hide
    /// (default 30 000 ms, `0` disables).
    public init(
        value: String?,
        variant: MaskVariant,
        showLast: Int? = nil,
        copyable: Bool = false,
        auditOnReveal: Bool = false,
        ariaLabel: String,
        autoHideMs: Int = MaskedValueInput.defaultAutoHideMs,
        auditRecorder: any MaskedValueAuditRecorder = OSLogMaskedValueAuditRecorder(),
        telemetry: any MaskedValueTelemetry = OSLogMaskedValueTelemetry()
    ) {
        let resolved = MaskedValueInput(
            value: value,
            variant: variant,
            showLast: showLast,
            copyable: copyable,
            auditOnReveal: auditOnReveal,
            ariaLabel: ariaLabel,
            autoHideMs: autoHideMs
        )
        input = resolved
        _model = State(initialValue: MaskedValueModel(
            input: resolved,
            auditRecorder: auditRecorder,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a recording audit double, a spy
    /// telemetry, a seeded input).
    public init(model: MaskedValueModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        MaskedValueContainer(
            projection: model.projection,
            revealed: model.revealed,
            onToggle: { model.toggle() }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }
}
