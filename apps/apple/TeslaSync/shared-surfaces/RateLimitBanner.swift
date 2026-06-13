//
//  RateLimitBanner.swift
//  TeslaSync — P4 shared surface · 0134 · RateLimitBanner (Apple)
//
//  The rate-limit / upstream-breaker UX banner — the SwiftUI parity of
//  `components/feedback/RateLimitBanner.tsx`. The web component listens for two document-level
//  CustomEvents (`teslasync:rate-limited` on a 429, `teslasync:upstream-down` on a 503 breaker-open),
//  shows a live countdown so the user understands why data isn't refreshing, enables "Retry now" when
//  the window elapses (invalidating every query), and lets the user dismiss it. This surface
//  reproduces that composition natively, bound through `RateLimitBannerModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the feed is resolving whether a notice applies → skeleton banner chrome.
//    • empty   — no fired event (web `if (!state) return null`) → friendly empty card, never a blank box.
//    • error   — the feed failed → a retryable error tile (web `QueryError` peer).
//    • data    — the active banner: kind icon, the live countdown message, and the
//                "Retry now" / dismiss affordances.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - RateLimitBanner (the shared surface)

/// The rate-limit / upstream-breaker banner — the SwiftUI parity of `RateLimitBanner.tsx`. Renders
/// every state plus the P4 leaf freshness states, binding through `RateLimitBannerModel`.
public struct RateLimitBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "RateLimitBanner"

    @State private var model: RateLimitBannerModel

    public init(model: RateLimitBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for host mounting — the parity of placing `<RateLimitBanner />` in the
    /// layout. Binds a `LiveRateLimitBannerSource` that observes the two transport notifications; an
    /// optional seed `event` renders the active banner immediately (used by hosts that already hold a
    /// fired event).
    public init(
        event: RateLimitBannerEvent? = nil,
        connection: RateLimitBannerConnection = .live
    ) {
        let source = LiveRateLimitBannerSource(event: event, connection: connection)
        _model = State(initialValue: RateLimitBannerModel(source: source))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                RateLimitBannerFreshnessChip(connection: model.connection) {
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
            RateLimitBannerLoadingView()
        case .empty:
            RateLimitBannerEmptyView()
        case let .error(message):
            RateLimitBannerErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                RateLimitBannerCard(
                    data: data,
                    onRetry: { model.retry() },
                    onDismiss: { model.dismiss() }
                )
            }
        }
    }
}
