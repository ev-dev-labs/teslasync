//
//  EditConflictBanner.swift
//  TeslaSync — P4 shared surface · 0118 · EditConflictBanner (Apple)
//
//  The SwiftUI surface — the public API of the edit-conflict banner, the parity of the web
//  `components/feedback/EditConflictBanner.tsx`. The view binds through `EditConflictBannerModel`
//  (P1/S8) for the resolved banner + the once-only `view.opened` telemetry (P1/S11); no networking
//  lives here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the lease election is in flight → skeleton banner chrome.
//    • empty   — no conflict (web `if (isOwner || otherTab === null) return null`) → friendly empty
//                state (the native improvement over the web component rendering nothing), never a blank
//                box.
//    • error   — the lease feed read failed with no observed conflict → a retryable error tile (web
//                `QueryError` peer).
//    • data    — the conflict notice: the headline + "{resource} is open in another tab …" copy plus the
//                "Take over editing" action and the informational switch hint; taking over hides it.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - EditConflictBanner (the shared surface)

/// The edit-conflict banner — the SwiftUI parity of the web `EditConflictBanner`. Renders every state
/// plus the P4 leaf freshness states, binding through `EditConflictBannerModel`.
public struct EditConflictBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = EditConflictBannerSurface.slug

    @State private var model: EditConflictBannerModel

    public init(model: EditConflictBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent mounting
    /// `<EditConflictBanner resourceKey resourceLabel />` over a live `useEditLease`. `isOwner` /
    /// `otherTab` are the lease state the hook reports; `onTakeOver` is an optional parent hook fired
    /// alongside the lease take-over.
    public init(
        resourceKey: String,
        resourceLabel: String? = nil,
        isOwner: Bool,
        otherTab: EditConflictPeer?,
        connection: EditConflictConnection = .live,
        onTakeOver: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticEditConflictSource(
            resourceKey: resourceKey,
            resourceLabel: resourceLabel,
            isOwner: isOwner,
            otherTab: otherTab,
            connection: connection
        )
        _model = State(initialValue: EditConflictBannerModel(source: source, onTakeOver: onTakeOver))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                EditConflictFreshnessChip(connection: model.connection) {
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
            EditConflictLoadingView()
        case .empty:
            EditConflictEmptyView()
        case let .error(message):
            EditConflictErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.data {
                EditConflictNoticeView(data: data, onTakeOver: { model.takeOver() })
            }
        }
    }
}
