//
//  BackgroundWorkersCard.Previews.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  Xcode previews for each surface state (loading / single-instance / replicated /
//  degraded+error / empty / error / stale / offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: WorkersInput) -> BackgroundWorkersModel {
        let source = InMemoryWorkersSource(initial: input)
        let model = BackgroundWorkersModel(source: source)
        model.start()
        return model
    }

    private let singleInstance = WorkersHealthSnapshot(workers: [
        WorkerInstance(
            name: "automation-worker",
            host: "http://automation-worker:8083/healthz",
            status: .healthy,
            latencyMs: 9
        ),
        WorkerInstance(
            name: "export-worker",
            host: "http://export-worker:8082/healthz",
            status: .healthy,
            latencyMs: 14
        ),
        WorkerInstance(
            name: "notification-worker",
            host: "http://notification-worker:8081/healthz",
            status: .healthy,
            latencyMs: 11
        )
    ])

    private let replicated = WorkersHealthSnapshot(workers: [
        WorkerInstance(name: "notification-worker", host: "http://nw-1:8081/healthz", status: .healthy, latencyMs: 8),
        WorkerInstance(
            name: "notification-worker",
            host: "http://nw-2:8081/healthz",
            status: .unhealthy,
            latencyMs: 220
        ),
        WorkerInstance(
            name: "notification-worker",
            host: "http://nw-3:8081/healthz",
            status: .down,
            latencyMs: nil,
            error: "dial tcp 10.0.0.4:8081: connect: connection refused"
        ),
        WorkerInstance(
            name: "export-worker",
            host: "http://export-worker:8082/healthz",
            status: .healthy,
            latencyMs: 13
        ),
        WorkerInstance(
            name: "automation-worker",
            host: "http://automation-worker:8083/healthz",
            status: .healthy,
            latencyMs: 10
        )
    ])

    #Preview("Loading") {
        BackgroundWorkersCard(model: previewModel(WorkersInput(isLoading: true, isFetching: true)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Single instance") {
        BackgroundWorkersCard(model: previewModel(WorkersInput(response: singleInstance)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Replicated + degraded") {
        BackgroundWorkersCard(model: previewModel(WorkersInput(response: replicated)))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BackgroundWorkersCard(model: previewModel(WorkersInput(response: WorkersHealthSnapshot(workers: []))))
            .padding()
            .frame(maxWidth: 560)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        BackgroundWorkersCard(model: previewModel(
            WorkersInput(errorMessage: "GET /system/workers failed: 503 Service Unavailable")
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        BackgroundWorkersCard(model: previewModel(
            WorkersInput(isFetching: true, response: singleInstance, isStale: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        BackgroundWorkersCard(model: previewModel(
            WorkersInput(response: replicated, isOffline: true)
        ))
        .padding()
        .frame(maxWidth: 560)
        .background(Color.TS.bg)
    }
#endif
