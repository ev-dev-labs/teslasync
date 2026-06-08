//
//  BackgroundWorkersCard.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  The composable Background-workers card — the SwiftUI parity of
//  features/system/components/status/BackgroundWorkersCard.tsx. Binds through
//  `BackgroundWorkersModel` (no networking in the view) and renders every state
//  the web source has (empty · populated) lifted under the standard P4 chrome
//  (loading · error+retry · stale · offline). The always-visible header + Refresh
//  sits above the state body, exactly like the page section that hosts the web
//  card.
//

import SwiftUI

/// The composable Background-workers card — the SwiftUI parity of
/// `features/system/components/status/BackgroundWorkersCard.tsx`. Renders every
/// state from the web source, binding through `BackgroundWorkersModel` (P1/S8).
/// No networking lives here.
public struct BackgroundWorkersCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "BackgroundWorkersCard"

    /// The in-app route the footer link opens (web `<Link to="/api-logs">`).
    public static let apiLogsRoute = "/api-logs"

    @State private var model: BackgroundWorkersModel
    private let onOpenAPILogs: (String) -> Void

    public init(
        model: BackgroundWorkersModel,
        onOpenAPILogs: @escaping (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onOpenAPILogs = onOpenAPILogs
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                BWPanelHeader(
                    isFetching: model.isFetching,
                    isStale: model.isStale,
                    isOffline: model.isOffline,
                    onRefresh: { model.refresh() }
                )
                stateBody
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var stateBody: some View {
        switch model.phase {
        case .loading:
            BWLoadingView()
        case let .error(message):
            BWErrorView(message: message) { model.refresh() }
        case .empty:
            BWEmptyView()
        case .data:
            BWContentView(
                groups: model.groups,
                summary: model.summary,
                onOpenAPILogs: onOpenAPILogs
            )
        }
    }
}
