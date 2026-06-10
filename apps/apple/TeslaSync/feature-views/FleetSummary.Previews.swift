//
//  FleetSummary.Previews.swift
//  TeslaSync — P4 feature view · 0276 · FleetSummary (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    enum FleetSummaryPreviewData {
        static func vehicles(_ count: Int) -> [FleetVehicle] {
            (0 ..< count).map { FleetVehicle(id: $0 + 1) }
        }

        static func states() -> [FleetVehicleState?] {
            [
                FleetVehicleState(batteryLevel: 82, ratedRangeMeters: 386_243, isCharging: false),
                FleetVehicleState(batteryLevel: 64, ratedRangeMeters: 301_750, isCharging: true),
                FleetVehicleState(batteryLevel: 41, ratedRangeMeters: 193_120, isCharging: true),
                nil
            ]
        }

        static func loaded(
            connection: FleetSummaryConnection = .live,
            isFetching: Bool = false
        ) -> FleetSummaryUpdate {
            FleetSummaryUpdate(
                vehicles: vehicles(4),
                states: states(),
                status: .loaded,
                connection: connection,
                isFetching: isFetching,
                units: FleetUnitPrefs(distance: "mi", localeIdentifier: "en_US"),
                updatedAt: Date().addingTimeInterval(connection == .live ? -4 : -180)
            )
        }

        static func empty() -> FleetSummaryUpdate {
            FleetSummaryUpdate(vehicles: [], status: .loaded)
        }

        static func failed() -> FleetSummaryUpdate {
            FleetSummaryUpdate(vehicles: vehicles(3), states: [], status: .failed("Network unavailable"))
        }
    }

    @MainActor
    private func fleetPreviewModel(_ update: FleetSummaryUpdate?) -> FleetSummaryModel {
        let source = InMemoryFleetSummarySource(initial: update)
        let model = FleetSummaryModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func fleetPreviewSurface(_ update: FleetSummaryUpdate?) -> some View {
        ScrollView {
            FleetSummary(model: fleetPreviewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        fleetPreviewSurface(FleetSummaryPreviewData.loaded())
    }

    #Preview("Loading") {
        fleetPreviewSurface(nil)
    }

    #Preview("Empty") {
        fleetPreviewSurface(FleetSummaryPreviewData.empty())
    }

    #Preview("Error") {
        fleetPreviewSurface(FleetSummaryPreviewData.failed())
    }

    #Preview("Stale (cached)") {
        fleetPreviewSurface(FleetSummaryPreviewData.loaded(connection: .stale))
    }

    #Preview("Offline") {
        fleetPreviewSurface(FleetSummaryPreviewData.loaded(connection: .offline))
    }
#endif
