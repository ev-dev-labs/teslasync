//
//  TeslaReauthBanner.swift
//  TeslaSync — P4 shared surface · 0142 · TeslaReauthBanner (Apple)
//
//  The SwiftUI surface — the public API of the Tesla re-authentication banner, the parity of the web
//  `components/feedback/TeslaReauthBanner.tsx`. The view binds through `TeslaReauthBannerModel` (P1/S8)
//  for the resolved banner + the once-only `view.opened` telemetry (P1/S11); no networking lives here.
//  Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the auth signal is being read → skeleton banner chrome.
//    • empty   — the grant is healthy / acknowledged (web `if (!visible) return null`) → a friendly
//                "connected" state (the native improvement over the web component rendering nothing),
//                never a blank box.
//    • error   — the auth signal read failed → a retryable error tile (web `QueryError` peer).
//    • data    — the disconnection notice: the "Tesla account disconnected" title + the reconnection
//                copy plus the "Reconnect" / "Dismiss" affordances (web `visible`).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TeslaReauthBanner (the shared surface)

/// The Tesla re-authentication banner — the SwiftUI parity of the web `TeslaReauthBanner`. Renders every
/// state plus the P4 leaf freshness states, binding through `TeslaReauthBannerModel`.
public struct TeslaReauthBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TeslaReauthBannerSurface.slug

    @State private var model: TeslaReauthBannerModel

    public init(model: TeslaReauthBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the self-driven mount — the parity of the web `<Layout>` mounting
    /// `<TeslaReauthBanner />`. The web component reads `useNavigate` (deep-link to `/tesla-account`) and
    /// `drainQueuedTeslaMutations` from module scope; here the composition root injects them as the
    /// `onReconnect` (required) and `onRecovered` (optional replay) seams, and supplies the initial grant
    /// status / connectivity the app's Tesla-auth signal reports.
    public init(
        status: TeslaReauthStatus = .connected,
        connection: TeslaReauthConnection = .live,
        onReconnect: @escaping @MainActor () -> Void,
        onRecovered: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticTeslaReauthSource(status: status, connection: connection)
        _model = State(initialValue: TeslaReauthBannerModel(
            source: source,
            onReconnect: onReconnect,
            onRecovered: onRecovered
        ))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                TeslaReauthFreshnessChip(connection: model.connection) {
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
            TeslaReauthLoadingView()
        case .empty:
            TeslaReauthEmptyView()
        case let .error(message):
            TeslaReauthErrorView(message: message) { model.refresh() }
        case .data:
            if let copy = model.copy {
                TeslaReauthNoticeView(
                    copy: copy,
                    onReconnect: { model.reconnect() },
                    onDismiss: { model.dismiss() }
                )
            }
        }
    }
}
