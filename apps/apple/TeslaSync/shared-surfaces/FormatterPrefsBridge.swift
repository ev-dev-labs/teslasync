//
//  FormatterPrefsBridge.swift
//  TeslaSync — P4 shared surface · 0146 · FormatterPrefsBridge (Apple)
//
//  The formatter-preferences bridge — the SwiftUI parity of `components/FormatterPrefsBridge.tsx`. The
//  web component mounts near the React root, renders `null`, and keeps the module-level number-format
//  globals in sync with the persisted user settings (refetching on the `settings.changed` broadcast).
//  This surface reproduces that side-effect through `FormatterPrefsBridgeModel` (P1/S8) — applying the
//  resolved locale + precision to the formatter globals via the injected applier — and, per the P4
//  leaf "never a blank box" contract, renders a compact, accessible diagnostic of the two values it
//  syncs across every state. No networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading        — the `['settings']` query is resolving → skeleton card chrome.
//    • unavailable    — the query failed → a retryable error tile (the web `QueryError` peer).
//    • usingDefaults  — resolved with nothing configured → the friendly "device defaults" card.
//    • applied        — resolved with an explicit pref → the active locale + precision card.
//    • stale / offline— the orthogonal `connection` axis → a freshness chip beneath the card with a
//                       one-shot auto-refresh on the stale transition; offline keeps the cached values.
//

import SwiftUI

// MARK: - FormatterPrefsBridge (the shared surface)

/// The formatter-preferences bridge — the SwiftUI parity of `FormatterPrefsBridge.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through `FormatterPrefsBridgeModel`. Mounting the
/// view starts the model (which applies the globals + subscribes to the settings-changed broadcast)
/// and emits the `view.opened` diagnostics event.
public struct FormatterPrefsBridge: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FormatterPrefsBridgeMeta.surfaceSlug

    @State private var model: FormatterPrefsBridgeModel

    public init(model: FormatterPrefsBridgeModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production settings feed + formatter-globals applier — the
    /// parity of mounting `<FormatterPrefsBridge />` near the app root. `input` is the host's current
    /// settings snapshot (the resolved `['settings']` query + connectivity); `applier` defaults to the
    /// process-wide globals store so mounting the surface keeps the live formatter globals in sync.
    public init(
        input: FormatterPrefsBridgeInput,
        config: FormatterPrefsBridgeConfig = .default,
        applier: any FormatterPrefsBridgeApplier = FormatterPrefsBridgeGlobalsApplier()
    ) {
        let source = LiveFormatterPrefsBridgeSource(
            status: input.status,
            settings: input.settings,
            connection: input.connection
        )
        _model = State(initialValue: FormatterPrefsBridgeModel(
            source: source,
            config: config,
            applier: applier
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                FormatterPrefsBridgeFreshnessChip(connection: model.connection) {
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
        switch model.phase {
        case .loading:
            FormatterPrefsBridgeLoadingView()
        case .unavailable:
            FormatterPrefsBridgeUnavailableView { model.refresh() }
        case let .usingDefaults(applied):
            FormatterPrefsBridgeDefaultsView(applied: applied)
        case let .applied(applied):
            FormatterPrefsBridgeAppliedView(applied: applied, offline: model.offline)
        }
    }
}
