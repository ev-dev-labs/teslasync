//
//  AlertBanner.swift
//  TeslaSync — P4 shared surface · 0113 · AlertBanner (Apple)
//
//  The AlertBanner shared surface — the SwiftUI parity of `components/feedback/AlertBanner.tsx`.
//  A persistent, page-level inline notification (info / success / warning / danger) driven by the
//  documented data sources: the `useMutationToast` bus and the live-connection holder (the
//  `OfflineBanner` / `LiveStaleDataBanner` consumers). Renders every state plus the P4 leaf
//  freshness states, binding through `AlertBannerModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the host is resolving whether a notice applies → skeleton banner chrome.
//    • empty   — nothing to surface → friendly empty state, never a blank box.
//    • error   — the feed failed → a retryable error tile (web `QueryError` peer).
//    • alert   — the banner itself: variant chrome (web `alertVariantMap`), optional title, message,
//                and the optional dismiss (web `onClose`).
//    • stale / offline — the orthogonal connectivity axis → the connectivity banner (web
//                `LiveStaleDataBanner` / `OfflineBanner`) plus a freshness chip with a one-shot
//                auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AlertBanner (the shared surface)

/// The AlertBanner shared surface — renders every state plus the P4 leaf freshness states, binding
/// through `AlertBannerModel`.
public struct AlertBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AlertBanner"

    @State private var model: AlertBannerModel

    public init(model: AlertBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled-host usage — the parity of a web host mounting
    /// `<AlertBanner …>` with the current notice + connectivity. A missing `onDismiss` hides the
    /// trailing X, exactly as the optional web `onClose` prop does.
    public init(
        notice: AlertBannerNotice? = nil,
        connection: AlertBannerConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        onDismiss: (@MainActor () -> Void)? = nil
    ) {
        let source = StaticAlertBannerSource(
            notice: notice,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        _model = State(initialValue: AlertBannerModel(source: source, onDismiss: onDismiss))
    }

    /// Convenience for the documented `useMutationToast` host usage — mounts the banner for a single
    /// mutation toast (bridged via `AlertBannerNotice.from(mutation:)`), with `onDismiss` mapped to
    /// the web `onClose`.
    public init(mutation: AlertBannerMutation, onDismiss: (@MainActor () -> Void)? = nil) {
        self.init(notice: AlertBannerNotice.from(mutation: mutation), onDismiss: onDismiss)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                AlertBannerFreshnessChip(connection: model.connection) {
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
            AlertBannerLoadingView()
        case .empty:
            AlertBannerEmptyView()
        case let .error(message):
            AlertBannerErrorView(message: message) { model.refresh() }
        case .alert:
            if let content = model.resolved.content {
                AlertBannerCard(content: content) { model.dismiss() }
            }
        }
    }
}
