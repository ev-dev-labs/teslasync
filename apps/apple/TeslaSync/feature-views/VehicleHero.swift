//
//  VehicleHero.swift
//  TeslaSync — P4 feature view · 0133 · VehicleHero (Apple)
//
//  The dashboard vehicle hero — the SwiftUI parity of
//  features/dashboard/components/VehicleHero.tsx. Renders the web source's regions
//  (the identity header, the context-aware radial gauges, the charging detail, the
//  stat grid, and the quick-action buttons) inside a glass panel, plus the P4 leaf
//  contract states. Binds through `VehicleHeroPanelModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch → skeleton chrome (web parent `isLoading`).
//    • data    — live state present → the full hero.
//    • asleep  — state resolved `null` → the web asleep panel with a Wake Up CTA; this
//                surface's friendly empty state, never a blank box.
//    • error   — parent query failure → retry affordance (web `QueryError` peer).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VehicleHero (the feature surface)

/// The dashboard vehicle hero — the SwiftUI parity of
/// `features/dashboard/components/VehicleHero.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `VehicleHeroPanelModel`.
public struct VehicleHero: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleHero"

    @State private var model: VehicleHeroPanelModel
    private let onNavigate: (VehicleHeroPanelRoute) -> Void

    public init(
        model: VehicleHeroPanelModel,
        onNavigate: @escaping (VehicleHeroPanelRoute) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                VehicleHeroPanelHeaderView(
                    header: model.resolved.header,
                    connection: model.connection,
                    onRefresh: { model.refresh() }
                )
                if model.connection != .live {
                    VehicleHeroPanelConnectivityBanner(connection: model.connection)
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states (web body branches + the P4 leaf contract)

private extension VehicleHero {
    @ViewBuilder
    var content: some View {
        let resolved = model.resolved
        switch resolved.phase {
        case .loading:
            VehicleHeroPanelLoadingView()
        case .asleep:
            VehicleHeroPanelAsleepView(onWake: { onNavigate(.commands) })
        case let .error(message):
            VehicleHeroPanelErrorView(message: message, onRetry: { model.refresh() })
        case .data:
            dataBody(resolved)
        }
    }

    func dataBody(_ resolved: VehicleHeroPanelResolved) -> some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                VehicleHeroPanelGaugeRow(gauges: resolved.gauges)
                if let charging = resolved.charging {
                    VehicleHeroPanelChargingView(detail: charging)
                }
                VehicleHeroPanelStatGrid(cards: resolved.statCards)
                VehicleHeroPanelActionRow(
                    actions: resolved.actions,
                    vehicleID: resolved.vehicleID,
                    onNavigate: onNavigate
                )
            }
        }
    }
}
