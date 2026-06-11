//
//  OfflineBanner.swift
//  TeslaSync — P4 shared surface · 0130 · OfflineBanner (Apple)
//
//  The SwiftUI surface — the public API of the offline banner, the parity of the web
//  `components/feedback/OfflineBanner.tsx`. The view binds through `OfflineBannerModel` (P1/S8) for the
//  resolved banner + the once-only `view.opened` telemetry (P1/S11); no connectivity monitoring lives
//  here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10 facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the initial connectivity probe is in flight → skeleton banner chrome.
//    • online  — connectivity resolved as online (web `if (online) return null`) → a calm, friendly
//                "you're connected" card (the native improvement over the web component rendering
//                nothing), never a blank box.
//    • offline — the warning banner: the "You're offline" title + the "Showing cached data…"
//                reassurance (web `<AlertBanner variant="warning" role="status" aria-live="polite">`),
//                plus an "Offline" freshness chip.
//    • error   — the connectivity probe failed with no cached reading → a retryable error tile (web
//                `QueryError` peer).
//    • stale   — the offline reading is older than the freshness window → the warning banner + a
//                "Stale" chip + a one-shot auto re-probe on the stale transition.
//
//  Mounting parity: the web banner is mounted globally (bottom-right, non-blocking) so even surfaces
//  outside the full layout advertise the offline state. The app mounts `OfflineBanner(model: .live())`.
//

import SwiftUI

// MARK: - OfflineBanner (the shared surface)

/// The offline banner — the SwiftUI parity of the web `OfflineBanner`. Renders every state plus the P4
/// leaf freshness states, binding through `OfflineBannerModel`.
public struct OfflineBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = OfflineBannerSurface.slug

    @State private var model: OfflineBannerModel

    public init(model: OfflineBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage — the native parity of the web
    /// parent observing `useOnlineStatus`. The supplied reading drives the rendered state without
    /// touching the device monitor; production mounts `OfflineBanner(model: .live())` instead.
    public init(
        status: OfflineConnectivity? = .offline,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        freshness: OfflineFreshness = .live,
        telemetry: any OfflineBannerTelemetry = OSLogOfflineBannerTelemetry()
    ) {
        let source = StaticOfflineBannerSource(OfflineBannerInput(
            status: status,
            isLoading: isLoading,
            errorMessage: errorMessage,
            freshness: freshness
        ))
        _model = State(initialValue: OfflineBannerModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.phase == .offline {
                OfflineBannerFreshnessChip(freshness: model.freshness) {
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
            OfflineBannerLoadingView()
        case .online:
            OfflineBannerOnlineView()
        case .offline:
            if let data = model.data {
                OfflineBannerCard(data: data)
            }
        case let .error(message):
            OfflineBannerErrorView(message: message) { model.refresh() }
        }
    }
}
