//
//  CurrencyInput.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  The currency-field surface — the SwiftUI parity of `components/forms/CurrencyInput.tsx`. The web
//  component is a controlled, currency-aware number field: it stores its value in integer micro-units
//  (1 major unit = 1_000_000), renders it locale-formatted with the currency symbol, parses typed
//  text on blur / Enter (symbol + ISO code + accounting parens + locale separators), and re-syncs
//  from the parent's `valueMicro` WITHOUT clobbering in-progress typing. This surface reproduces that
//  field and adds the P4 leaf states (loading / error / stale / offline) so it never collapses to a
//  blank box. It binds through `CurrencyInputFieldModel` (P1/S8); no networking lives here.
//
//  Type-name note: the sibling `Currency` display surface (0083) already owns a module-public
//  `CurrencyInput` value type, so the view is named `CurrencyInputField`; the diagnostics slug stays
//  "CurrencyInput".
//
//  States (every one renders — no hidden surface):
//    • loading  — the bound value's fetch in flight → skeleton field.
//    • ready    — the editable field; renders whether the value is empty (with a "not set" hint) or
//                 populated (web blank value + populated value both visible, never a blank box).
//    • error    — the parent's settings fetch failed → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the field with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - CurrencyInputField (the shared surface)

/// The currency-field surface — the SwiftUI parity of `components/forms/CurrencyInput.tsx`. Renders
/// every state plus the P4 leaf freshness states, binding through `CurrencyInputFieldModel`.
public struct CurrencyInputField: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = CurrencyInputFieldMeta.surfaceSlug

    @State private var model: CurrencyInputFieldModel

    /// Designated initializer — adopts a fully-wired model (the production app threads the P1/S8
    /// source through it; previews + tests inject an in-memory source).
    public init(model: CurrencyInputFieldModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<CurrencyInput valueMicro={…} currency="USD" ariaLabel={…} onChange={…} />`. Wires a
    /// `LiveCurrencyInputFieldSource` over the value snapshot and forwards commits to `onChange`.
    public init(
        valueMicro: Int?,
        currency: String,
        ariaLabel: String,
        locale: Locale = .autoupdatingCurrent,
        precision: Int = CurrencyInputFieldMeta.defaultPrecision,
        isRequired: Bool = false,
        isDisabled: Bool = false,
        telemetry: any CurrencyInputFieldTelemetry = OSLogCurrencyInputFieldTelemetry(),
        onChange: @escaping @MainActor (Int?) -> Void
    ) {
        let input = CurrencyInputFieldInput(
            valueMicro: valueMicro,
            currency: currency,
            locale: locale,
            precision: precision,
            ariaLabel: ariaLabel,
            isRequired: isRequired,
            isDisabled: isDisabled
        )
        let source = LiveCurrencyInputFieldSource(value: input, onCommit: onChange)
        _model = State(initialValue: CurrencyInputFieldModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            content
            if model.connection != .live {
                CurrencyInputFieldFreshnessChip(connection: model.connection) {
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
            CurrencyInputFieldLoadingView()
        case let .error(message):
            CurrencyInputFieldErrorView(message: message) { model.refresh() }
        case .ready:
            CurrencyInputFieldReadyView(model: model, resolved: model.resolved)
        }
    }
}
