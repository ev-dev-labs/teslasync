//
//  ServiceHealthSection.Previews.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  Xcode previews for each surface state (data / no-vehicles / loading / empty /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ServiceHealthPreviewData {
        static let vehicles: [StreamingVehicleDTO] = [
            StreamingVehicleDTO(
                vin: "5YJ3E1EA7KF000001",
                isStreaming: true,
                signalCount: 184_204,
                signalsPerSecond: 12.4,
                latencyMs: 42,
                lastReceived: "2026-04-04T13:05:00Z"
            ),
            StreamingVehicleDTO(
                vin: "5YJSA1E26MF000002",
                isStreaming: true,
                signalCount: 98120,
                signalsPerSecond: 8.1,
                latencyMs: 58,
                lastReceived: "2026-04-04T13:04:30Z"
            ),
            StreamingVehicleDTO(
                vin: "7SAYGDEE9PF000003",
                isStreaming: false,
                signalCount: 4210,
                signalsPerSecond: 0,
                latencyMs: 0,
                lastReceived: "2026-04-04T11:48:10Z"
            )
        ]

        static let telemetry = TelemetryStatusDTO(
            enabled: true,
            mode: "fleet-telemetry",
            aggregate: AggregateStatsDTO(totalSignalsReceived: 286_534, avgSignalsPerSecond: "20.5"),
            vehicles: vehicles
        )

        static let idleTelemetry = TelemetryStatusDTO(
            enabled: false,
            mode: "polling",
            aggregate: AggregateStatsDTO(totalSignalsReceived: 0, avgSignalsPerSecond: "0"),
            vehicles: []
        )
    }

    @MainActor
    private func previewSection(_ input: ServiceHealthInput) -> ServiceHealthSection {
        let source = InMemoryServiceHealthSource(initial: input)
        return ServiceHealthSection(source: source, initiallyExpanded: true)
    }

    #Preview("Data") {
        ScrollView {
            previewSection(ServiceHealthInput(telemetry: ServiceHealthPreviewData.telemetry))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("No vehicles") {
        ScrollView {
            previewSection(ServiceHealthInput(telemetry: ServiceHealthPreviewData.idleTelemetry))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ScrollView {
            previewSection(ServiceHealthInput(isLoading: true))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ScrollView {
            previewSection(ServiceHealthInput())
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ScrollView {
            previewSection(ServiceHealthInput(errorMessage: "Network request timed out"))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            previewSection(ServiceHealthInput(
                telemetry: ServiceHealthPreviewData.telemetry,
                connection: .stale
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            previewSection(ServiceHealthInput(
                telemetry: ServiceHealthPreviewData.telemetry,
                connection: .offline
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
