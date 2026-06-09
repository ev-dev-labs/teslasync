//
//  RouteMapSection.swift
//  TeslaSync — P4 feature view · 0147 · RouteMapSection (Apple)
//
//  The composable drive-detail route map — the SwiftUI parity of
//  features/driving/components/drive-detail/RouteMapSection.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content): a "Route" panel whose body is
//  either the MapKit canvas (speed-colored trail + start/end markers, or the stationary-GPS anchor +
//  banner) or the "No route data available" copy, with a speed legend + start/end-time footer. Binds
//  through `RouteMapSectionModel` (P1/S8). No networking lives here; the freshness chip + auto-refresh
//  reflect the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension RouteMapSectionStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - RouteMapSection (the drive-detail route map)

/// The composable drive-detail route map — the SwiftUI parity of
/// `features/driving/components/drive-detail/RouteMapSection.tsx`. Renders every state from the web
/// source, binding through `RouteMapSectionModel` (P1/S8). The view performs no routing or networking
/// itself.
public struct RouteMapSection: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = RouteMapSectionSurface.slug

    @State private var model: RouteMapSectionModel
    @State private var mapStyle: TSMapStyle = .standard

    /// - Parameter model: the P1/S8 state-holder the map binds through.
    public init(model: RouteMapSectionModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    header
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `<h3>` "Route" + native freshness chip)

private extension RouteMapSection {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "mappin.and.ellipse")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            RouteMapSectionStrings.text("driveDetail.route", "Route")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                RouteMapFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    updatedAt: model.updatedAt
                )
            }
        }
    }

    /// The chip appears only while fetching or when the bound source is stale/offline (the prompt's
    /// stale-chip / offline-chip states); a live, idle map is chrome-free.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Content states

private extension RouteMapSection {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            RouteMapSkeleton()
        case .empty:
            RouteMapNoData()
        case let .error(message):
            RouteMapErrorView(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection, projection.hasTrail {
                RouteMapResolved(projection: projection, mapStyle: $mapStyle)
            } else {
                RouteMapNoData()
            }
        }
    }
}
