//
//  RecentActivity.Vehicles.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  The vehicles "Recent Activity" surface — the SwiftUI parity of
//  features/vehicles/components/RecentActivity.tsx. Two glass panels (Recent Drives, Recent Charges)
//  fade in on appear, laid out responsively (side-by-side on a regular width, stacked on a compact
//  width — the web `grid-cols-1 lg:grid-cols-2` intent). Switches over the bound model's phase so
//  every prompt-required state renders (loading / empty / error / stale / offline / content) — never
//  a blank box. Binds through `VehicleRecentActivityModel` (P1/S8); no networking here.
//
//  Note on naming: the dashboard surface (prompt 0130) owns the bare `RecentActivity.*` type/file
//  names; this vehicles surface (prompt 0277) is a distinct component, so its types are namespaced
//  `VehicleRecentActivity*` and its files `RecentActivity.Vehicles.*` (both match the allowed
//  `RecentActivity.*` glob) so the two surfaces coexist and compile together.
//

import SwiftUI

/// The navigation intents the surface raises (web `<Link>` targets), wired by the host to its
/// router so the view itself stays navigation-free.
public enum VehicleRecentActivityRoute: Equatable, Sendable {
    case allDrives
    case allCharges
    case drive(String)
    case charge(String)
}

/// The vehicles Recent Activity surface — the SwiftUI parity of the web `RecentActivity`, binding
/// through `VehicleRecentActivityModel` (P1/S8). `onNavigate` carries the web `<Link>` affordances
/// (the per-panel "View all" + each row's deep link), wired by the host to navigation.
public struct VehicleRecentActivity: View {
    @State private var model: VehicleRecentActivityModel
    private let onNavigate: (VehicleRecentActivityRoute) -> Void
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    public init(
        model: VehicleRecentActivityModel,
        onNavigate: @escaping (VehicleRecentActivityRoute) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                HStack(spacing: TSSpacing.sm) {
                    Spacer(minLength: 0)
                    VehicleRecentActivityFreshnessChip(connection: model.connection)
                }
                VehicleRecentActivityConnectivityBanner(connection: model.connection)
            }
            content
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web two-panel grid, widened to the full load envelope (loading / error / empty / content)
    /// so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            VehicleRecentActivityLoading()
        case let .error(message):
            VehicleRecentActivityError(message: message) { model.refresh() }
        case .empty:
            VehicleRecentActivityEmpty()
        case .content:
            panels
        }
    }

    /// The two panels — side-by-side on a regular width (web `lg:grid-cols-2`), stacked on a compact
    /// width (web `grid-cols-1`). Each fades in with the web per-panel delay.
    @ViewBuilder
    private var panels: some View {
        if horizontalSizeClass == .compact {
            VStack(spacing: TSSpacing.lg) {
                TSFadeIn(delay: 0.25) { drivesPanel }
                TSFadeIn(delay: 0.27) { chargesPanel }
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                TSFadeIn(delay: 0.25) { drivesPanel }
                    .frame(maxWidth: .infinity, alignment: .top)
                TSFadeIn(delay: 0.27) { chargesPanel }
                    .frame(maxWidth: .infinity, alignment: .top)
            }
        }
    }

    /// The Recent Drives panel (web first `GlassPanel`).
    private var drivesPanel: some View {
        VehicleRecentActivityPanel(
            icon: "road.lanes",
            tint: Color.TS.accent,
            titleKey: "common.recentDrives",
            titleFallback: "Recent Drives",
            rows: model.driveRows,
            emptyKey: "common.noDrives",
            emptyFallback: "No drives recorded yet",
            onViewAll: { onNavigate(.allDrives) },
            onSelect: { onNavigate(.drive($0)) }
        )
    }

    /// The Recent Charges panel (web second `GlassPanel`).
    private var chargesPanel: some View {
        VehicleRecentActivityPanel(
            icon: "battery.100.bolt",
            tint: Color.TS.statusSuccess,
            titleKey: "common.recentCharges",
            titleFallback: "Recent Charges",
            rows: model.chargeRows,
            emptyKey: "common.noCharges",
            emptyFallback: "No charging sessions recorded yet",
            onViewAll: { onNavigate(.allCharges) },
            onSelect: { onNavigate(.charge($0)) }
        )
    }
}
