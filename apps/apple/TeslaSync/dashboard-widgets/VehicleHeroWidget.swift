//
//  VehicleHeroWidget.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The composable Vehicle Card dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VehicleHeroWidget.tsx (+ components/VehicleHero.tsx).
//  Binds through `VehicleHeroModel` (no networking in the view); renders every
//  state (loading / empty / error / stale / offline / content + the asleep branch).
//

import Foundation
import SwiftUI

// MARK: - Navigation seam (web `<Link>` targets)

/// The destinations the hero's quick-actions + wake button route to (web `<Link>`s
/// to `/vehicles/:id`, `/commands`, `/live`, `/digital-twin`). The view never
/// builds routes itself; the host injects `onNavigate`.
public enum VehicleHeroDestination: Equatable, Sendable {
    case details(vehicleId: Int64)
    case commands
    case liveMap
    case digitalTwin
    case wake
}

// MARK: - VehicleHeroWidget (the dashboard surface)

/// The composable Vehicle Card dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VehicleHeroWidget.tsx`. Renders every state from the
/// web source inside a glass widget shell, binding through `VehicleHeroModel`
/// (P1/S8). No networking lives here.
public struct VehicleHeroWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleHeroWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-hero").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-hero",
        nameKey: "hero.title",
        descriptionKey: "hero.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 9),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: VehicleHeroModel
    private let size: DashboardWidgetSize
    private let onNavigate: ((VehicleHeroDestination) -> Void)?

    public init(
        model: VehicleHeroModel,
        size: DashboardWidgetSize = VehicleHeroWidget.registration.defaultSize,
        onNavigate: ((VehicleHeroDestination) -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = VehicleHeroWidget.registration.clamp(size)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VehicleHeroLoadingChrome()
        case .empty:
            VehicleHeroEmptyState()
        case let .error(message):
            VehicleHeroErrorState(message: message) { model.refresh() }
        case .content:
            loaded
        }
    }

    @ViewBuilder
    private var loaded: some View {
        if let projection = model.projection {
            ScrollView(.vertical, showsIndicators: false) {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    header(projection)
                    if model.connection != .live {
                        VehicleHeroConnectivityBanner(connection: model.connection)
                    }
                    if projection.hasState {
                        VehicleHeroStateContent(projection: projection, onNavigate: onNavigate)
                    } else {
                        VehicleHeroAsleepPanel { onNavigate?(.wake) }
                    }
                }
                .padding(TSSpacing.lg)
            }
        } else {
            VehicleHeroEmptyState()
        }
    }

    private func header(_ projection: VehicleHeroProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: projection.title)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                VehicleHeroStatusBadge(status: projection.status)
                Spacer(minLength: TSSpacing.sm)
                VehicleHeroFreshnessChip(connection: model.connection, updatedAt: model.updatedAt)
                VehicleHeroRefreshButton { model.refresh() }
            }
            Text(verbatim: projection.subtitle)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: projection.accessibilitySummary))
    }
}
