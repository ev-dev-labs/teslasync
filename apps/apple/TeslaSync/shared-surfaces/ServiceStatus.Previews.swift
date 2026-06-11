//
//  ServiceStatus.Previews.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  Xcode previews for each surface state (healthy / degraded / down / empty / loading / error /
//  stale / offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope. The previews use the manual poller so no real time elapses.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ServiceStatusPreviewData {
        static func snapshot(_ overall: String) -> SystemStatusSnapshot {
            SystemStatusSnapshot.fromSystemStatus(
                overall: overall,
                database: "healthy",
                teslaApi: overall,
                mqtt: "healthy",
                worker: overall == "down" ? "down" : "degraded"
            )
        }
    }

    @MainActor
    private func previewModel(_ input: ServiceStatusInput) -> ServiceStatusModel {
        let source = InMemoryServiceStatusSource(initial: input)
        let model = ServiceStatusModel(source: source, poller: ManualServiceStatusPoller())
        model.start()
        return model
    }

    #Preview("Data — healthy") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            status: ServiceStatusPreviewData.snapshot("healthy")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — degraded") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            status: ServiceStatusPreviewData.snapshot("degraded")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — down") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            status: ServiceStatusPreviewData.snapshot("down")
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ServiceStatus(model: previewModel(ServiceStatusInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ServiceStatus(model: previewModel(ServiceStatusInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            errorMessage: "The /system/status request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            status: ServiceStatusPreviewData.snapshot("degraded"),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ServiceStatus(model: previewModel(ServiceStatusInput(
            status: ServiceStatusPreviewData.snapshot("healthy"),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
