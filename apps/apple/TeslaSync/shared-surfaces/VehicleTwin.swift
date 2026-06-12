//
//  VehicleTwin.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The VehicleTwin shared surface — the SwiftUI parity of web/src/components/vehicles/VehicleTwin.tsx.
//  It composes the module's reusable `VehicleTwinView` Canvas illustration (the layered side-profile
//  EV whose doors / windows / lights / lock / sentry / charge are driven by `VehicleTwinState`) with
//  the always-visible status legend and the P4 leaf chrome (freshness chip + connectivity banner +
//  loading / error / empty states), bound through `VehicleTwinSurfaceModel` (P1/S8). No networking or
//  storage lives in the view; the paint override + telemetry route through the model's seams.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch with no cached vehicle → skeleton chrome.
//    • empty   — resolved with no vehicle in scope → friendly empty state.
//    • error   — initial fetch failed with no cached vehicle → retryable error.
//    • content — a vehicle is in scope → the twin illustration + legend, with the orthogonal
//                connectivity axis (live / stale / offline) driving the header chip + banner and a
//                one-shot auto-refresh on the stale transition. The twin's own visual branches
//                (doors / windows / frunk / trunk / charge / lights / turn / lock / sentry / seat /
//                driving / drive-in) all render from the bound `VehicleTwinState`.
//

import SwiftUI

// MARK: - VehicleTwin (the shared surface)

/// The VehicleTwin shared surface — the SwiftUI parity of `VehicleTwin.tsx`. Renders every state from
/// the web source plus the P4 leaf freshness states, binding through `VehicleTwinSurfaceModel`.
public struct VehicleTwin: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleTwin"

    @State private var model: VehicleTwinSurfaceModel

    public init(model: VehicleTwinSurfaceModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                VehicleTwinConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: VehicleTwinStrings.string(
                "vehicles.twin.a11yLabel",
                "Vehicle digital twin showing current physical state"
            ))
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Header

private extension VehicleTwin {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: VehicleTwinStrings.string("vehicles.twin.title", "Digital Twin"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            VehicleTwinFreshnessChip(connection: model.connection)
            VehicleTwinRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension VehicleTwin {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            VehicleTwinLoadingView()
        case let .error(message):
            VehicleTwinErrorView(message: message) { model.refresh() }
        case .empty:
            VehicleTwinEmptyView()
        case .content:
            if let content = model.content {
                VehicleTwinReadyBody(content: content)
            }
        }
    }
}
