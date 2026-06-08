//
//  TelemetryErrorsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  Xcode previews for each surface state (idle / loading / error / data / empty-ok /
//  empty-unknown-shape). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: TelemetryErrorsInput) -> TelemetryErrorsModel {
        let source = InMemoryTelemetryErrorsSource(initial: input)
        let model = TelemetryErrorsModel(source: source)
        model.start()
        return model
    }

    private let previewVIN = "5YJ3E1EA7KF000001"

    private let previewErrorsResponse = TelemetryJSON.object([
        .init("response", .object([
            .init("errors", .array([
                .object([
                    .init("reported_at", .string("2026-01-05T15:04:05Z")),
                    .init("error_code", .string("telemetry_disconnected")),
                    .init("error_message", .string("Vehicle stopped streaming telemetry")),
                    .init("vin", .string(previewVIN))
                ]),
                .object([
                    .init("timestamp", .string("2026-01-04T09:30:00Z")),
                    .init("code", .string("auth_token_expired")),
                    .init("message", .string("Partner authentication token expired")),
                    .init("vin", .string(previewVIN))
                ])
            ]))
        ]))
    ])

    private let previewEmptyOK = TelemetryJSON.object([
        .init("response", .object([.init("errors", .array([]))]))
    ])

    private let previewUnknownShape = TelemetryJSON.object([
        .init("status", .string("ok")),
        .init("note", .string("envelope omitted by proxy"))
    ])

    #Preview("Idle") {
        TelemetryErrorsPanel(model: previewModel(TelemetryErrorsInput(requested: false)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TelemetryErrorsPanel(model: previewModel(TelemetryErrorsInput(requested: true, loading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TelemetryErrorsPanel(model: previewModel(
            TelemetryErrorsInput(requested: true, errorMessage: "Tesla API returned 503 Service Unavailable")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data") {
        TelemetryErrorsPanel(model: previewModel(
            TelemetryErrorsInput(requested: true, response: previewErrorsResponse, vin: previewVIN)
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (healthy)") {
        TelemetryErrorsPanel(model: previewModel(
            TelemetryErrorsInput(requested: true, response: previewEmptyOK, vin: previewVIN)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (unknown shape)") {
        TelemetryErrorsPanel(model: previewModel(
            TelemetryErrorsInput(requested: true, response: previewUnknownShape, vin: previewVIN)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
