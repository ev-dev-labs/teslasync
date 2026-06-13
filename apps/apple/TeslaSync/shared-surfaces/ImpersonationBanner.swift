//
//  ImpersonationBanner.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  The admin impersonation banner surface — the SwiftUI parity of
//  `components/feedback/ImpersonationBanner.tsx`. The web component renders a persistent (NOT
//  dismissible) amber sticky bar whenever the calling browser carries a valid impersonation cookie:
//  the impersonated subject, the remaining cookie lifetime as a once-a-second countdown, and an "End
//  impersonation" button; in open-mode installs it renders nothing. The native surface binds through
//  `ImpersonationBannerModel` (P1/S8); no transport lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the first status read is in flight → skeleton banner chrome.
//    • empty   — there is no active session: the admin is themselves (web `{ mode: 'inactive' }`) or
//                the install is open-mode (web `{ mode: 'open' }`) → a calm, honest card per kind,
//                never a blank box.
//    • error   — the status read failed → a retryable error tile (web `QueryError` peer).
//    • data    — the active session: the warning-tinted banner with the subject, the live countdown,
//                and the "End impersonation" affordance (web amber sticky bar).
//    • stale / offline — the orthogonal `connection` axis → freshness chip beneath the surface with a
//                one-shot auto-refresh on the stale transition.
//
//  Mounting parity: the web banner sits at the very top of `<Layout>`, above every other operational
//  banner. The app mounts `ImpersonationBanner(model: .live(gateway:))` in the same position.
//

import SwiftUI

// MARK: - ImpersonationBanner (the shared surface)

/// The admin impersonation banner — the SwiftUI parity of `ImpersonationBanner.tsx`. Renders every
/// state plus the P4 leaf connectivity states, binding through `ImpersonationBannerModel`.
public struct ImpersonationBanner: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — re-exposed from the model so app callers can
    /// reference `ImpersonationBanner.surfaceSlug` while the canonical value lives in the pure core.
    public static let surfaceSlug = ImpersonationBannerModel.surfaceSlug

    @State private var model: ImpersonationBannerModel

    public init(model: ImpersonationBannerModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled / preview / test usage — drives the rendered state from
    /// a supplied snapshot without a gateway. Production mounts `ImpersonationBanner(model: .live())`.
    public init(
        status: ImpersonationBannerStatus = .inactive,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        isEnding: Bool = false,
        connection: ImpersonationBannerConnection = .live,
        now: @escaping @Sendable () -> Date = { Date() },
        telemetry: any ImpersonationBannerTelemetry = OSLogImpersonationBannerTelemetry()
    ) {
        let source = InMemoryImpersonationBannerSource(initial: ImpersonationBannerInput(
            status: status,
            isLoading: isLoading,
            errorMessage: errorMessage,
            isEnding: isEnding,
            connection: connection
        ))
        _model = State(initialValue: ImpersonationBannerModel(source: source, telemetry: telemetry, now: now))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            content
            if model.connection != .live {
                ImpersonationBannerFreshnessChip(connection: model.connection) {
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
            ImpersonationBannerLoadingView()
        case .empty:
            ImpersonationBannerEmptyView(kind: model.resolved.emptyKind ?? .inactive)
        case let .error(message):
            ImpersonationBannerErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                ImpersonationBannerActiveCard(
                    data: data,
                    countdown: model.countdownText(using: ImpersonationBannerStrings.string)
                ) {
                    model.endImpersonation()
                }
            }
        }
    }
}
