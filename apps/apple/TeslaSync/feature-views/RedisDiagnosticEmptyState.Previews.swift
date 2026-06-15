//
//  RedisDiagnosticEmptyState.Previews.swift
//  TeslaSync — P4 feature view · 0039 · RedisDiagnosticEmptyState (Apple)
//
//  Xcode previews for each diagnostic branch + the generic P4 states (loading / empty /
//  error / stale / offline mapped to the faithful web branches). DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RedisDiagnosticInput) -> RedisDiagnosticModel {
        let source = InMemoryRedisDiagnosticSource(initial: input)
        let model = RedisDiagnosticModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func previewSurface(_ input: RedisDiagnosticInput) -> some View {
        ScrollView {
            RedisDiagnosticEmptyState(model: previewModel(input))
                .padding()
        }
        .background(Color.TS.bg)
    }

    private let previewVehicleID = 7

    private func previewMeta(
        mode: RedisLiveStoreMode = .hybrid,
        l1: Int = 0,
        l2: Int = 0,
        l1LastSeen: Date? = nil
    ) -> RedisDiagnosticSignalsMeta {
        RedisDiagnosticSignalsMeta(
            liveSignalStoreMode: mode,
            redisKey: "vehicle:7:signals",
            redisFieldCount: l2,
            l1SignalCount: l1,
            vehicleVin: "TESLA1234567890",
            l1LastSeenAt: l1LastSeen
        )
    }

    private let previewKeys = RedisDiagnosticKeysState.loaded([
        RedisSignalKeyEntry(vehicleId: 1, fieldCount: 230, vehicleVin: "VIN1", displayName: "Falcon"),
        RedisSignalKeyEntry(vehicleId: 7, fieldCount: 0),
        RedisSignalKeyEntry(vehicleId: 12, fieldCount: 142, vehicleVin: "VIN12", displayName: "Phoenix")
    ])

    // MARK: Upstream-error branches (0.A – 0.D)

    #Preview("Cache not wired (503)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            serverError: RedisApiError(status: 503, message: "Redis signal cache is not available")
        ))
    }

    #Preview("Unreachable (503)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            serverError: RedisApiError(status: 503, message: "Redis is unreachable")
        ))
    }

    #Preview("Request failed (500 · error)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(),
            serverError: RedisApiError(status: 500, message: "database query failed")
        ))
    }

    #Preview("Network error (offline)") {
        previewSurface(RedisDiagnosticInput(vehicleId: previewVehicleID, networkError: true))
    }

    // MARK: No-meta fallback + meta branches (1 – 4)

    #Preview("Legacy empty (no meta)") {
        previewSurface(RedisDiagnosticInput(vehicleId: previewVehicleID))
    }

    #Preview("Mode local") {
        previewSurface(RedisDiagnosticInput(vehicleId: previewVehicleID, meta: previewMeta(mode: .local)))
    }

    #Preview("Mirror broken") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(l1: 42, l2: 0, l1LastSeen: Date().addingTimeInterval(-3600)),
            keys: previewKeys
        ))
    }

    #Preview("No telemetry (stale · 10d)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(l1: 0, l2: 0, l1LastSeen: Date().addingTimeInterval(-10 * 86400)),
            keys: previewKeys
        ))
    }

    #Preview("No telemetry (absent)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(l1: 0, l2: 0, l1LastSeen: nil),
            keys: previewKeys
        ))
    }

    #Preview("Fallthrough (neutral)") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(l1: 0, l2: 0, l1LastSeen: Date().addingTimeInterval(-3600)),
            keys: previewKeys
        ))
    }

    #Preview("Other vehicles loading") {
        previewSurface(RedisDiagnosticInput(
            vehicleId: previewVehicleID,
            meta: previewMeta(l1: 0, l2: 0, l1LastSeen: nil),
            keys: .loading
        ))
    }
#endif
