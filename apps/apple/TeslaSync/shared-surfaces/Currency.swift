//
//  Currency.swift
//  TeslaSync — P4 shared surface · 0083 · Currency (Apple)
//
//  The SwiftUI parity of `components/data-display/format/Currency.tsx`: a presentational view that
//  renders a monetary `value` with the user's preferred currency symbol (from settings, the web
//  `useFormatting().currencySymbol`) and a locale-aware numeric portion, falling back to a glyph
//  (default em dash) for a null / non-finite value. The component performs no FX conversion — the
//  value is rendered verbatim with the chosen symbol, exactly as the web does.
//
//  The view binds the `CurrencyModel` state-holder (P1/S8) for the formatting projection and the
//  once-only `view.opened` telemetry (P1/S11); no networking lives in the view. The colour and font
//  are inherited from the use-site (the web span carries none of its own), so callers tint the figure
//  with the P1/S9 tokens.
//

import SwiftUI

/// The currency display — the SwiftUI parity of the web `Currency`. Renders `{symbol}{number}` for a
/// finite value (with the canonical amount as a tooltip) or the `fallback` glyph otherwise, and
/// voices the on-screen content to VoiceOver.
public struct Currency: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CurrencyMeta.surfaceSlug

    private let input: CurrencyInput
    @State private var model: CurrencyModel

    /// Designated initializer — adopts a fully-formed input snapshot (the production app threads the
    /// P1/S8 settings projection through `CurrencyInput.settings`) and an injectable telemetry sink
    /// (the production `os.Logger` default, a spy in tests).
    public init(
        input: CurrencyInput,
        telemetry: any CurrencyTelemetry = OSLogCurrencyTelemetry()
    ) {
        self.input = input
        _model = State(initialValue: CurrencyModel(input: input, telemetry: telemetry))
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<Currency value={…} precision={…} symbolOverride={…} fallback={…} />`. `currencySymbol` is the
    /// resolved symbol the web reads from `useFormatting()` (default `"$"`); a `symbolOverride` still
    /// wins over it.
    public init(
        value: Double?,
        precision: Int = CurrencyMeta.defaultPrecision,
        symbolOverride: String? = nil,
        fallback: String = CurrencyMeta.defaultFallback,
        currencySymbol: String = CurrencyMeta.defaultCurrencySymbol,
        locale: Locale = .autoupdatingCurrent
    ) {
        self.init(input: CurrencyInput(
            value: value,
            precision: precision,
            symbolOverride: symbolOverride,
            fallback: fallback,
            settings: CurrencyFormattingSettings(rawCurrencySymbol: currencySymbol),
            locale: locale
        ))
    }

    public var body: some View {
        CurrencyText(resolved: model.resolved)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
            .onAppear { model.start() }
            .onChange(of: input) { _, newInput in model.sync(newInput) }
    }
}
