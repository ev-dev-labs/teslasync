//
//  VehicleCard.Previews.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  #if DEBUG previews — one per state + branch of the web source: content
//  (online, not charging), content (charging), content (awaiting live state),
//  the stale / offline freshness over a cached card, and the loading / empty /
//  error chrome. Previews use the bundle-free `.echo` localizer so the English
//  copy renders without the folded catalog, `.metricPreview` formatting, and
//  no-op actions so they are side-effect-free.
//

#if DEBUG
    import SwiftUI

    @MainActor
    private enum VehicleCardPreview {
        static let actions = VehicleCardActions(
            onViewDetails: { _ in },
            onDelete: { _ in }
        )

        static func vehicle() -> VehicleCardVehicle {
            VehicleCardVehicle(
                id: 1,
                displayName: "Lightning",
                vin: "5YJ3E1EA7KF000000",
                model: "Model 3",
                trimBadging: "Performance"
            )
        }

        static func state(
            batteryLevel: Int = 73,
            isCharging: Bool = false,
            chargerPowerWatts: Double = 0,
            stateString: String = "online"
        ) -> VehicleCardLiveState {
            VehicleCardLiveState(
                state: stateString,
                batteryLevel: batteryLevel,
                ratedRangeMeters: 350_000,
                insideTempCelsius: 21.5,
                odometerMeters: 19_874_000,
                chargerPowerWatts: chargerPowerWatts,
                speedMetersPerSecond: 0,
                isCharging: isCharging,
                isLocked: true,
                sentryMode: true
            )
        }

        static func model(_ update: VehicleCardUpdate) -> VehicleCardModel {
            VehicleCardModel(
                source: InMemoryVehicleCardSource(initial: update),
                formatting: .metricPreview,
                localize: .echo,
                telemetry: OSLogVehicleCardTelemetry()
            )
        }

        static func card(_ update: VehicleCardUpdate) -> some View {
            VehicleCard(model: model(update), actions: actions, localize: .echo)
                .padding()
                .frame(maxWidth: 520)
                .background(Color.TS.bg)
        }
    }

    #Preview("Content · online") {
        VehicleCardPreview.card(
            VehicleCardUpdate(status: .loaded, vehicle: VehicleCardPreview.vehicle(), state: VehicleCardPreview.state())
        )
    }

    #Preview("Content · charging") {
        VehicleCardPreview.card(
            VehicleCardUpdate(
                status: .loaded,
                vehicle: VehicleCardPreview.vehicle(),
                state: VehicleCardPreview.state(
                    batteryLevel: 41,
                    isCharging: true,
                    chargerPowerWatts: 11000,
                    stateString: "charging"
                )
            )
        )
    }

    #Preview("Content · awaiting live state") {
        VehicleCardPreview.card(
            VehicleCardUpdate(status: .loaded, vehicle: VehicleCardPreview.vehicle(), state: nil)
        )
    }

    #Preview("Content · stale") {
        VehicleCardPreview.card(
            VehicleCardUpdate(
                status: .loaded,
                connection: .stale,
                vehicle: VehicleCardPreview.vehicle(),
                state: VehicleCardPreview.state(batteryLevel: 18)
            )
        )
    }

    #Preview("Content · offline") {
        VehicleCardPreview.card(
            VehicleCardUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: VehicleCardPreview.vehicle(),
                state: VehicleCardPreview.state(batteryLevel: 54)
            )
        )
    }

    #Preview("Loading") {
        VehicleCardPreview.card(VehicleCardUpdate(status: .loading))
    }

    #Preview("Empty") {
        VehicleCardPreview.card(VehicleCardUpdate(status: .empty))
    }

    #Preview("Error") {
        VehicleCardPreview.card(VehicleCardUpdate(status: .failed("Network unavailable")))
    }
#endif
