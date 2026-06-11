//
//  ServiceStatus.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The composite service-status surface — the SwiftUI parity of `components/data-display/
//  ServiceStatus.tsx`. The web file ships two presentational exports (`ServiceStatusBanner` +
//  `SystemHealthDot`); this surface composes both into one bound view: the offline banner on top
//  and the `overall` health dot (with its subsystem breakdown) below, driven through
//  `ServiceStatusModel` (P1/S8). No networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — first `/system/status` fetch in flight → skeleton dot-row.
//    • empty   — no rollup value yet (web `if (!data) return null`) → friendly empty card.
//    • error   — the fetch failed → a retryable error tile (web `QueryError` peer).
//    • data    — the health dot: tone-tinted by `overall`, with the subsystem breakdown.
//    • stale / offline — the orthogonal `connection` axis → the offline banner (offline) and a
//                freshness chip beside the dot, with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - ServiceStatus (the shared surface)

/// The composite service-status surface — the SwiftUI parity of `ServiceStatus.tsx`. Renders every
/// state plus the P4 leaf connectivity states, binding through `ServiceStatusModel`.
public struct ServiceStatus: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ServiceStatus"

    @State private var model: ServiceStatusModel

    public init(model: ServiceStatusModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for controlled usage — the parity of a parent mounting the surface
    /// with the latest `/system/status` snapshot + connectivity. The app pushes fresh data by
    /// handing the surface a new model whose source is updated out of band.
    public init(
        status: SystemStatusSnapshot? = nil,
        connection: ServiceStatusConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        telemetry: any ServiceStatusTelemetry = OSLogServiceStatusTelemetry()
    ) {
        let source = StaticServiceStatusSource(
            status: status,
            connection: connection,
            isLoading: isLoading,
            errorMessage: errorMessage
        )
        _model = State(initialValue: ServiceStatusModel(source: source, telemetry: telemetry))
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ServiceStatusBanner(isOffline: model.connection == .offline)
            content
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
            ServiceStatusLoadingView()
        case .empty:
            ServiceStatusEmptyView()
        case let .error(message):
            ServiceStatusErrorView(message: message) { model.refresh() }
        case .data:
            if let data = model.resolved.data {
                dataCard(data)
            }
        }
    }

    private func dataCard(_ data: ServiceStatusData) -> some View {
        TSFadeIn {
            TSCard {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    HStack(spacing: TSSpacing.sm) {
                        ServiceStatusDotRow(data: data)
                        Spacer(minLength: TSSpacing.sm)
                        if model.connection != .live {
                            ServiceStatusFreshnessChip(connection: model.connection) {
                                model.refresh()
                            }
                        }
                    }
                    if !data.components.isEmpty {
                        Divider().overlay(Color.TS.border)
                        ServiceStatusComponentsList(components: data.components)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
