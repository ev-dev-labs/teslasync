//
//  MaintenanceBanner.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The SwiftUI surface — the public API of the maintenance / degraded-mode banner, the parity of the web
//  `components/feedback/MaintenanceBanner.tsx`. The view binds through `MaintenanceBannerModel` (P1/S8)
//  for the resolved banner + the live countdown + the once-only `view.opened` telemetry (P1/S11); no
//  networking lives here. Chrome is token-driven (P1/S9) and every string resolves through the P1/S10
//  facade.
//
//  States (every one renders — no hidden surface):
//    • loading — the first `/system/health` read is in flight → skeleton banner chrome.
//    • empty   — `mode === 'ok'` or the current snapshot is dismissed (web `return null`) → friendly
//                empty state (the native improvement over the web component rendering nothing), never a
//                blank box.
//    • error   — the initial health read failed with no payload yet → a retryable error tile.
//    • banner  — the maintenance (amber + wrench) or degraded (sky + triangle) notice: the headline +
//                body + the live countdown to `maintenance_until` + the dismiss control.
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the banner with a
//                one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - MaintenanceBanner (the shared surface)

/// The maintenance / degraded-mode banner — the SwiftUI parity of the web `MaintenanceBanner`. Renders
/// every state plus the P4 leaf freshness states, binding through `MaintenanceBannerModel`.
public struct MaintenanceBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = MaintenanceBannerSurface.slug

    @State private var model: MaintenanceBannerModel

    public init(model: MaintenanceBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-prop usage — the parity of the web parent mounting
    /// `<MaintenanceBanner />` over a live `useSystemHealth`. `mode` / `message` / `until` / `updatedAt`
    /// are the resolved `/system/health` fields the query reports; `connection` is the P4 freshness axis.
    public init(
        mode: MaintenanceBannerServiceMode,
        message: String = "",
        until: String = "",
        updatedAt: String = "",
        connection: MaintenanceBannerConnection = .live
    ) {
        let source = StaticMaintenanceBannerSource(MaintenanceBannerInput(
            mode: mode.rawValue,
            message: message,
            until: until,
            updatedAt: updatedAt,
            hasData: true,
            connection: connection
        ))
        _model = State(initialValue: MaintenanceBannerModel(source: source))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                MaintenanceBannerFreshnessChip(connection: model.connection) {
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
            MaintenanceBannerLoadingView()
        case .empty:
            MaintenanceBannerEmptyView()
        case let .error(message):
            MaintenanceBannerErrorView(message: message) { model.refresh() }
        case .banner:
            if let data = model.data {
                MaintenanceBannerNoticeView(data: data, countdown: model.countdownText) {
                    model.dismiss()
                }
            }
        }
    }
}
