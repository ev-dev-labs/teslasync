//
//  AiLimitBanner.swift
//  TeslaSync — P4 shared surface · 0025 · AiLimitBanner (Apple)
//
//  The AI rate-limit / cost-cap banner — the SwiftUI parity of `components/ai/AiLimitBanner.tsx`.
//  The web component is a fully-controlled `AlertBanner`: the parent supplies the `AiLimitInfo`
//  (the `limit` field from `useAiStream`) and the handlers, and the banner renders a reason-keyed
//  heading + description, a live "Try again in Ns" countdown, and the "Use baseline" / "Retry"
//  affordances. This surface reproduces that composition natively, bound through
//  `AiLimitBannerModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the parent is resolving whether a limit applies → skeleton banner chrome.
//    • empty   — no active limit (web `if (!info) return null`) → friendly empty state, never a
//                blank box.
//    • error   — the feed failed → a retryable error tile (web `QueryError` peer).
//    • data    — the active limit banner: severity (web variant), reason title + description, the
//                live countdown, and the baseline / retry / dismiss affordances.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with
//                a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AiLimitBanner (the shared surface)

/// The AI rate-limit / cost-cap banner — the SwiftUI parity of `AiLimitBanner.tsx`. Renders every
/// state plus the P4 leaf freshness states, binding through `AiLimitBannerModel`.
public struct AiLimitBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AiLimitBanner"

    @State private var model: AiLimitBannerModel

    public init(model: AiLimitBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent
    /// mounting `<AiLimitBanner info={limit} onRetry={…} onUseBaseline={…} onDismiss={…} />`. A
    /// missing handler hides the matching affordance, exactly as the optional web props do.
    public init(
        info: AiLimitInfo?,
        connection: AiLimitConnection = .live,
        onRetry: (@MainActor () -> Void)? = nil,
        onUseBaseline: (@MainActor () -> Void)? = nil,
        onDismiss: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticAiLimitBannerSource(info: info, connection: connection)
        _model = State(initialValue: AiLimitBannerModel(
            source: source,
            onRetry: onRetry,
            onUseBaseline: onUseBaseline,
            onDismiss: onDismiss
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                AiLimitBannerFreshnessChip(connection: model.connection) {
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
            AiLimitBannerLoadingView()
        case .empty:
            AiLimitBannerEmptyView()
        case let .error(message):
            AiLimitBannerErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                AiLimitBannerCard(
                    data: data,
                    onUseBaseline: { model.useBaseline() },
                    onRetry: { model.retry() },
                    onDismiss: { model.dismiss() }
                )
            }
        }
    }
}
