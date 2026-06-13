//
//  LiveStaleDataBanner.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  The SwiftUI surface — the public API of the live-stale-data banner, the parity of the web
//  `components/feedback/LiveStaleDataBanner.tsx`. The view binds through `LiveStaleDataBannerModel`
//  (P1/S8) for the resolved banner + the once-only `view.opened` telemetry (P1/S11); no transport
//  monitoring lives here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10
//  facade. A main-run-loop ticker re-derives the resolved state so the banner appears shortly after the
//  outage crosses two minutes (the native port of the web `setTimeout`); the publisher only fires while
//  the view is subscribed.
//
//  States (every one renders — no hidden surface):
//    • loading — the live status is not yet known (the web hook's `unknown` seed) → skeleton chrome.
//    • healthy — connected / reconnecting / a sub-two-minute disconnect (web `return null`) → a calm,
//                friendly "live data connected" card (the native improvement over the web component
//                rendering nothing), never a blank box.
//    • stale   — the warning banner: the "Live data unavailable" title + the "offline for more than 2
//                minutes…" reassurance (web `<AlertBanner variant="warning" role="status">`), plus an
//                "Offline" / "Stale" chip with a tap-to-reconnect affordance.
//    • error   — the live-status feed failed with no observed outage → a retryable error tile (web
//                `QueryError` peer).
//
//  Mounting parity: the web banner is dropped near the top of any page whose content depends on live
//  telemetry. The app mounts `LiveStaleDataBanner` over a host-observed live-status source.
//

import Combine
import SwiftUI

// MARK: - LiveStaleDataBanner (the shared surface)

/// The live-stale-data banner — the SwiftUI parity of the web `LiveStaleDataBanner`. Renders every
/// state plus the P4 leaf freshness chip, binding through `LiveStaleDataBannerModel` and re-deriving the
/// resolved state on a periodic tick so the two-minute outage promotion needs no further transport
/// traffic.
public struct LiveStaleDataBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveStaleDataBannerSurface.slug

    @State private var model: LiveStaleDataBannerModel

    /// The web banner schedules a single `setTimeout` at the two-minute boundary; the native parity
    /// ticks the model off a main-run-loop timer so the outage promotion stays current without further
    /// transport events. `.onReceive`'s action is a main-actor, non-`@Sendable` closure, so it can call
    /// the `@MainActor` model directly. The publisher only fires while the view is subscribed.
    private let ticker = Timer
        .publish(every: LiveStaleWindow.tickIntervalSeconds, on: .main, in: .common)
        .autoconnect()

    public init(model: LiveStaleDataBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage — the native parity of the web
    /// parent observing `useLiveConnection`. The supplied reading drives the rendered state without
    /// touching a real transport; production wires a host-observed `LiveConnectionStaleDataSource`.
    public init(
        status: LiveStaleStatus = .unknown,
        statusSince: Date = Date(),
        errorMessage: String? = nil,
        freshness: LiveStaleFreshness = .live,
        telemetry: any LiveStaleDataBannerTelemetry = OSLogLiveStaleDataBannerTelemetry(),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        let source = LiveConnectionStaleDataSource(LiveStaleDataBannerInput(
            status: status,
            statusSince: statusSince,
            errorMessage: errorMessage,
            freshness: freshness
        ))
        _model = State(initialValue: LiveStaleDataBannerModel(source: source, telemetry: telemetry, clock: clock))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.phase == .stale {
                LiveStaleDataBannerChip(freshness: model.freshness) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onReceive(ticker) { _ in model.tick() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            LiveStaleDataBannerLoadingView()
        case .healthy:
            LiveStaleDataBannerHealthyView()
        case .stale:
            if let data = model.data {
                LiveStaleDataBannerCard(data: data)
            }
        case let .error(message):
            LiveStaleDataBannerErrorView(message: message) { model.refresh() }
        }
    }
}
