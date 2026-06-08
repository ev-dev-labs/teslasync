//
//  FleetApiSection.Previews.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  Xcode previews for every section state (content / loading / empty / error /
//  stale / offline) plus the signal-config sheet and the telemetry-errors panel
//  branches. DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum FleetPreviewData {
        static let fleetInfo = JSONValue.object([
            "baseUrl": .string("https://fleet-api.prd.na.vn.cloud.tesla.com"),
            "clientId": .string("ev-dev-labs-teslasync"),
            "authenticated": .bool(true),
            "regions": .array([.string("na"), .string("eu")]),
            "hostname": .string("teslasync.example.com")
        ])

        static let publicKeyStatus = JSONValue.object([
            "configured": .bool(true),
            "fingerprint": .string("SHA256:ab:cd:ef:12:34:56"),
            "wellKnownUrl": .string("https://teslasync.example.com/.well-known/appspecific/com.tesla.3p.public-key.pem")
        ])

        static let vehicles = [
            VehicleOption(vin: "5YJ3E1EA7KF000001", label: "Red Model 3"),
            VehicleOption(vin: "7SAYGDEE9PF000002", label: "Blue Model S")
        ]

        static let errorsPayload = JSONValue.object([
            "response": .object(["errors": .array([
                .object([
                    "reported_at": .string("2026-01-02T03:04:05Z"),
                    "error_code": .string("STREAM_DISCONNECT"),
                    "error_message": .string("Telemetry stream dropped"),
                    "vin": .string("5YJ3E1EA7KF000001")
                ])
            ])])
        ])

        static let canned: [String: ToolResult] = [
            "fleet-status": .success(.object(["online": .number(2), "asleep": .number(0)])),
            "fleet-telemetry-errors": .success(errorsPayload),
            "fleet-telemetry-config": .success(.object(["config": .object(["port": .number(443)])]))
        ]

        static func snapshot(
            connection: FleetConnection = .live,
            fleetInfo: FleetQuery = .loaded(fleetInfo),
            keyStatus: FleetQuery = .loaded(publicKeyStatus),
            updatedAt: Date? = Date()
        ) -> FleetSnapshot {
            FleetSnapshot(
                fleetInfo: fleetInfo,
                publicKeyStatus: keyStatus,
                vehicles: vehicles,
                connection: connection,
                updatedAt: updatedAt
            )
        }
    }

    @MainActor
    private func previewModel(
        _ snapshot: FleetSnapshot,
        runs: [FleetRequest] = []
    ) -> FleetApiSectionModel {
        let source = InMemoryFleetApiSource(initial: snapshot, canned: FleetPreviewData.canned)
        let model = FleetApiSectionModel(source: source)
        model.start()
        for request in runs {
            model.run(request)
        }
        return model
    }

    private let previewRuns = [
        FleetRequest(id: "fleet-status", endpoint: "fleet-status", method: .post),
        FleetRequest(id: "fleet-telemetry-errors", endpoint: "fleet-telemetry-errors?vin=5YJ"),
        FleetRequest(id: "fleet-telemetry-config", endpoint: "fleet-telemetry-config?vin=5YJ")
    ]

    #Preview("Content") {
        FleetApiSection(model: previewModel(FleetPreviewData.snapshot(), runs: previewRuns))
            .frame(width: 720, height: 900)
    }

    #Preview("Loading") {
        FleetApiSection(model: previewModel(
            FleetSnapshot(fleetInfo: .loading, publicKeyStatus: .loading, updatedAt: nil)
        ))
        .frame(width: 480, height: 640)
    }

    #Preview("Empty") {
        FleetApiSection(model: previewModel(
            FleetSnapshot(fleetInfo: .loaded(.object([:])), publicKeyStatus: .loaded(.object([:])))
        ))
        .frame(width: 480, height: 640)
    }

    #Preview("Error") {
        FleetApiSection(model: previewModel(
            FleetSnapshot(fleetInfo: .failed("Network unavailable"), publicKeyStatus: .failed("Network unavailable"))
        ))
        .frame(width: 480, height: 640)
    }

    #Preview("Stale") {
        FleetApiSection(model: previewModel(
            FleetPreviewData.snapshot(connection: .stale, updatedAt: Date().addingTimeInterval(-300))
        ))
        .frame(width: 720, height: 900)
    }

    #Preview("Offline (cached)") {
        FleetApiSection(model: previewModel(
            FleetPreviewData.snapshot(connection: .offline, updatedAt: Date().addingTimeInterval(-1800))
        ))
        .frame(width: 720, height: 900)
    }

    #Preview("Signal config sheet") {
        FleetSignalConfigSheet(
            initialSelected: ["VehicleSpeed", "BatteryLevel"],
            initialInterval: 30
        ) { _, _ in }
    }

    #Preview("Telemetry errors — table") {
        FleetTelemetryErrorsPanel(
            titleKey: "Telemetry Errors", titleFallback: "Telemetry Errors",
            phase: FleetApiBuilder.telemetryErrorsPhase(from: .success(FleetPreviewData.errorsPayload)),
            vin: "5YJ3E1EA7KF000001"
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Telemetry errors — empty drift") {
        FleetTelemetryErrorsPanel(
            titleKey: "Telemetry Errors", titleFallback: "Telemetry Errors",
            phase: .empty(ok: false, raw: .object(["unexpected": .string("shape")])),
            vin: "5YJ"
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
