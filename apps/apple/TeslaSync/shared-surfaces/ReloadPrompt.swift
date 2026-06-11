//
//  ReloadPrompt.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The SwiftUI surface — the public API of the new-version reload prompt, the parity of the web
//  `ReloadPrompt` (`components/feedback/ReloadPrompt.tsx`). The view binds through `ReloadPromptModel`
//  (P1/S8) for the registration's update / connectivity state + the once-only `view.opened` telemetry
//  (P1/S11); no networking lives here. Chrome is token-driven (P1/S9) and every string resolves through
//  the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the first update check is in flight → skeleton banner chrome.
//    • empty   — checked, no newer build → friendly "up to date" state (the native improvement over the
//                web rendering `null`), never a blank box.
//    • error   — the registration failed with no staged update → a retryable error tile (web
//                `onRegisterError` / `QueryError` peer).
//    • data    — a newer build is staged → the reload banner counting down to auto-reload (web
//                `needRefresh` true).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip beneath the surface with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ReloadPrompt (the shared surface)

/// The new-version reload prompt — the SwiftUI parity of the web `ReloadPrompt`. Renders every state
/// plus the P4 leaf freshness states, binding through `ReloadPromptModel`.
public struct ReloadPrompt: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ReloadPrompt"

    @State private var model: ReloadPromptModel

    public init(model: ReloadPromptModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled usage — the parity of the web app mounting
    /// `<ReloadPrompt />`. Seeds a static source from whether a newer build is staged + the connectivity;
    /// `onApply` is the embedder's activation hand-off (the native peer of `updateServiceWorker(true)`,
    /// e.g. relaunching into the staged build).
    public init(
        updateAvailable: Bool = false,
        connection: ReloadPromptConnection = .live,
        onApply: @escaping @MainActor () -> Void = {}
    ) {
        let update = ReloadPromptUpdate(
            status: .idle,
            connection: connection,
            updateAvailable: updateAvailable
        )
        let source = StaticReloadPromptSource(update, onApply: onApply)
        _model = State(initialValue: ReloadPromptModel(source: source))
    }

    public var body: some View {
        VStack(alignment: .trailing, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                ReloadPromptFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ReloadPromptLoadingView()
        case .empty:
            ReloadPromptEmptyView()
        case let .error(message):
            ReloadPromptErrorView(message: message) { model.refresh() }
        case .data:
            ReloadPromptBanner(
                countdown: model.countdown,
                onTick: { model.tick() },
                onLater: { model.dismiss() },
                onReloadNow: { model.reloadNow() }
            )
        }
    }
}
