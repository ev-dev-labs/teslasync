//
//  VehicleHeroCard.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The public surface — the SwiftUI parity of `web/src/components/vehicles/VehicleHeroCard.tsx`. It binds the
//  P1/S8 ``VehicleHeroCardModel`` (no networking in the view), renders the glass shell (web `GlassPanel`
//  glow="cyan"), and switches the P4 render phase: a loading skeleton, a friendly empty state, an error tile
//  with retry, and — in content — the optional hero photo, the identity header, the connectivity chip +
//  banner (stale / offline), the four gauges + eight stat cards (or the no-live-data fallback when there is
//  no live state), and the three navigation actions. `view.opened` (P1/S11) fires once on appear.
//

import SwiftUI

// MARK: - VehicleHeroCard (the shared surface)

/// The vehicle hero card — the SwiftUI parity of `VehicleHeroCard.tsx`. Renders every state, binding through
/// ``VehicleHeroCardModel``.
public struct VehicleHeroCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleHeroCardSurface.slug

    /// The web `shadow-[0_0_15px_rgba(34,211,238,0.1)]` cyan glow (GlassPanel `glow="cyan"`).
    private static let cyanGlow = Color(.sRGB, red: 34 / 255, green: 211 / 255, blue: 238 / 255, opacity: 1)

    @State private var model: VehicleHeroCardModel

    /// Designated initializer binding a pre-built model — the host / preview / test seam.
    public init(model: VehicleHeroCardModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer building the model from the P1/S8 seams — the parity of mounting
    /// `<VehicleHeroCard …>` with the production source + navigation callback. The host implements `source`
    /// over the composed vehicle + vehicle-state + photo + units feeds and routes `onNavigate` to its stack.
    public init(
        source: any VehicleHeroCardSource,
        onNavigate: @escaping @MainActor (VehicleHeroCardRoute) -> Void = { _ in },
        telemetry: any VehicleHeroCardTelemetry = OSLogVehicleHeroCardTelemetry()
    ) {
        _model = State(initialValue: VehicleHeroCardModel(
            source: source,
            onNavigate: onNavigate,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        phaseContent
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel(cornerRadius: TSRadius.lg)
            .shadow(color: Self.cyanGlow.opacity(0.1), radius: 15)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var phaseContent: some View {
        switch model.phase {
        case .loading:
            VehicleHeroCardLoading()
        case .empty:
            VehicleHeroCardEmpty()
        case let .error(message):
            VehicleHeroCardErrorTile(message: message) { model.refresh() }
        case .content:
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if let projection = model.projection {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                if model.connection != .live {
                    HStack {
                        Spacer(minLength: 0)
                        VehicleHeroCardFreshnessChip(connection: model.connection) { model.refresh() }
                    }
                }
                if let url = model.photoURL {
                    VehicleHeroCardPhoto(url: url, alt: projection.photoAlt ?? projection.identity.title)
                }
                VehicleHeroCardHeader(identity: projection.identity)
                if model.connection != .live {
                    VehicleHeroCardConnectivityBanner(connection: model.connection) { model.refresh() }
                }
                liveContent(projection)
                VehicleHeroCardActionBar(vehicleID: projection.identity.vehicleID) { model.navigate($0) }
            }
        } else {
            VehicleHeroCardEmpty()
        }
    }

    @ViewBuilder
    private func liveContent(_ projection: VehicleHeroCardProjection) -> some View {
        if projection.hasLiveState {
            VehicleHeroCardGaugeFlow(gauges: projection.gauges)
            VehicleHeroCardStatGrid(stats: projection.stats)
        } else {
            VehicleHeroCardNoLiveData()
        }
    }
}
