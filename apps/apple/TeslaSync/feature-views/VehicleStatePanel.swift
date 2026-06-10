//
//  VehicleStatePanel.swift
//  TeslaSync — P4 feature view · 0287 · VehicleStatePanel (Apple)
//
//  The Vehicle State telemetry panel — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx. Renders the web
//  source's body (the lights rows, the driver/keys rows, and the access-mode rows,
//  separated into three sections) inside a glass panel, plus the P4 leaf contract
//  states. Binds through `VehicleStateModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — no live reading resolved → friendly empty state, never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (the three row sections).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - VehicleStatePanel (the feature surface)

/// The Vehicle State telemetry panel — the SwiftUI parity of
/// `features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `VehicleStateModel`.
public struct VehicleStatePanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleStatePanel"

    @State private var model: VehicleStateModel

    public init(model: VehicleStateModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: VehicleStateStrings.string("vehicleState.title", "Vehicle State")))
    }
}

// MARK: - Header (web `<h3 class="section-title"><Activity/> Vehicle State … Live></h3>`)

private extension VehicleStatePanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: VehicleStateStrings.string("vehicleState.title", "Vehicle State"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            VehicleStateFreshnessChip(connection: model.connection)
            refreshButton
        }
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: VehicleStateStrings.string("vehicleState.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? VehicleStateStrings.string("vehicleState.offlineBanner", "Offline — showing last known data")
            : VehicleStateStrings.string("vehicleState.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension VehicleStatePanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            VehicleStateLoadingView()
        case .empty:
            VehicleStateEmptyView()
        case let .error(message):
            VehicleStateErrorView(message: message) { model.refresh() }
        case let .data(projection):
            VehicleStateContent(projection: projection)
        }
    }
}
