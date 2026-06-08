//
//  FleetTelemetryHealth.Previews.swift
//  TeslaSync — P4 feature view · 0005 · FleetTelemetryHealth (Apple)
//
//  Xcode previews for each surface state (content / filtered / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: FleetHealthUpdate) -> FleetHealthModel {
        let source = InMemoryFleetHealthSource(initial: update)
        let model = FleetHealthModel(source: source)
        model.start()
        return model
    }

    private func previewVINs(now: Date = Date()) -> [FleetTelemetryErrorVINInput] {
        [
            FleetTelemetryErrorVINInput(
                vin: "5YJ3E1EA7KF000111",
                firstSeenAt: now.addingTimeInterval(-86400 * 3),
                lastSeenAt: now.addingTimeInterval(-3600)
            ),
            FleetTelemetryErrorVINInput(
                vin: "5YJSA1E26MF000222",
                firstSeenAt: now.addingTimeInterval(-86400 * 9),
                lastSeenAt: now.addingTimeInterval(-86400 * 2)
            ),
            FleetTelemetryErrorVINInput(
                vin: "7SAYGDEE9PF000333",
                firstSeenAt: now.addingTimeInterval(-86400 * 1),
                lastSeenAt: now.addingTimeInterval(-86400 * 5)
            )
        ]
    }

    private func previewErrors(now: Date = Date()) -> [FleetTelemetryErrorInput] {
        [
            FleetTelemetryErrorInput(
                id: "1",
                vin: "5YJ3E1EA7KF000111",
                errorCode: "FLEET_TELEMETRY_CONFIG_INVALID",
                errorMessage: "Telemetry config rejected: unknown field 'foo'",
                reportedAt: now.addingTimeInterval(-1800)
            ),
            FleetTelemetryErrorInput(
                id: "2",
                vin: "5YJSA1E26MF000222",
                errorCode: nil,
                errorMessage: "Vehicle certificate expired",
                reportedAt: now.addingTimeInterval(-86400 * 2)
            ),
            FleetTelemetryErrorInput(
                id: "3",
                vin: "7SAYGDEE9PF000333",
                errorCode: "STREAM_DISCONNECTED",
                errorMessage: nil,
                reportedAt: now.addingTimeInterval(-86400)
            )
        ]
    }

    private func loadedUpdate(
        connection: FleetHealthConnection = .live,
        selectedVin: String? = nil
    ) -> FleetHealthUpdate {
        let errors = selectedVin.map { vin in previewErrors().filter { $0.vin == vin } } ?? previewErrors()
        return FleetHealthUpdate(
            vinsStatus: .loaded,
            vins: previewVINs(),
            errorsStatus: errors.isEmpty ? .empty : .loaded,
            errors: errors,
            connection: connection,
            selectedVin: selectedVin,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: FleetHealthUpdate) -> some View {
        ScrollView {
            FleetTelemetryHealth(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewSurface(loadedUpdate())
    }

    #Preview("Filtered VIN") {
        previewSurface(loadedUpdate(selectedVin: "5YJSA1E26MF000222"))
    }

    #Preview("Empty") {
        previewSurface(
            FleetHealthUpdate(vinsStatus: .loaded, vins: [], errorsStatus: .loaded, errors: [])
        )
    }

    #Preview("Loading") {
        previewSurface(FleetHealthUpdate(vinsStatus: .loading, errorsStatus: .loading))
    }

    #Preview("Error") {
        previewSurface(
            FleetHealthUpdate(
                vinsStatus: .failed("Network unavailable"),
                errorsStatus: .failed("Network unavailable")
            )
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }
#endif
