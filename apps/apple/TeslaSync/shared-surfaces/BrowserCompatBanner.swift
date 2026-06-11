//
//  BrowserCompatBanner.swift
//  TeslaSync — P4 shared surface · 0114 · BrowserCompatBanner (Apple)
//
//  The platform-compatibility banner surface — the SwiftUI parity of
//  `components/feedback/BrowserCompatBanner.tsx`. The web component renders a sticky, dismissible
//  warning when the host browser is missing required web-platform features; the native surface is the
//  device analogue, warning when the running OS is missing a framework TeslaSync depends on. It binds
//  through `BrowserCompatBannerModel` (P1/S8); no detection or persistence lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the one-shot capability detection in flight → skeleton banner chrome.
//    • empty   — the device is supported (web `missing.length === 0`) OR the user dismissed an active
//                warning (web `dismissed`) → a calm, honest card per kind, never a blank box.
//    • error   — detection failed → a retryable error tile (web `QueryError` peer).
//    • data    — the active warning: the warning-tinted banner listing the missing capabilities + the
//                recommendation, with the dismiss affordance (web `<AlertBanner variant="warning">`).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the surface with a
//                one-shot auto-refresh (re-probe) on the stale transition.
//
//  Mounting parity: the web banner sits at the top of `<Layout>`, above the service-status banner.
//  The app mounts `BrowserCompatBanner(model: .live())` in the same position.
//

import SwiftUI

// MARK: - BrowserCompatBanner (the shared surface)

/// The platform-compatibility banner — the SwiftUI parity of `BrowserCompatBanner.tsx`. Renders every
/// state plus the P4 leaf connectivity states, binding through `BrowserCompatBannerModel`.
public struct BrowserCompatBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — re-exposed from the model so app callers can
    /// reference `BrowserCompatBanner.surfaceSlug` while the canonical value lives in the pure core.
    public static let surfaceSlug = BrowserCompatBannerModel.surfaceSlug

    @State private var model: BrowserCompatBannerModel

    public init(model: BrowserCompatBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage — the native parity of the web
    /// `testHookMissing` seam. The supplied `missing` set drives the rendered state without touching
    /// the device probe; production mounts `BrowserCompatBanner(model: .live())` instead.
    public init(
        missing: [RequiredCapability] = [],
        dismissed: Bool = false,
        connection: BrowserCompatConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        telemetry: any BrowserCompatBannerTelemetry = OSLogBrowserCompatBannerTelemetry()
    ) {
        let source = InMemoryBrowserCompatBannerSource(initial: BrowserCompatInput(
            missing: missing,
            dismissed: dismissed,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        ))
        _model = State(initialValue: BrowserCompatBannerModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                BrowserCompatBannerFreshnessChip(connection: model.connection) {
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
            BrowserCompatLoadingView()
        case .empty:
            BrowserCompatEmptyView(kind: model.resolved.emptyKind ?? .compatible)
        case let .error(message):
            BrowserCompatErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                BrowserCompatBannerCard(data: data) { model.dismiss() }
            }
        }
    }
}
