//
//  StatorTempChart.Previews.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  Xcode previews for each surface state (content °C / °F / single series / stale / offline /
//  loading / empty / single-snapshot / error). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: StatorTempUpdate) -> StatorTempChartModel {
        let source = InMemoryStatorTempSource(initial: update)
        let model = StatorTempChartModel(source: source)
        model.start()
        return model
    }

    /// A short ramp of SI Celsius snapshots one minute apart, climbing through the Normal (60) and
    /// Warm (80) thresholds so both reference lines are exercised.
    private func previewSnapshots(includeRearRight: Bool = true) -> [StatorTempSnapshot] {
        let base = Date(timeIntervalSince1970: 1_717_790_400) // 2024-06-07 20:00:00 UTC
        let front: [Double] = [42, 48, 55, 61, 68, 74, 79, 83]
        let rearLeft: [Double] = [40, 45, 52, 58, 64, 70, 75, 78]
        let rearRight: [Double?] = [38, 43, 49, 55, nil, 66, 71, 75]
        return front.indices.map { idx in
            StatorTempSnapshot(
                timestamp: base.addingTimeInterval(Double(idx) * 60),
                frontC: front[idx],
                rearLeftC: rearLeft[idx],
                rearRightC: includeRearRight ? rearRight[idx] : nil
            )
        }
    }

    private func loadedUpdate(
        unit: StatorTempUnit = .celsius,
        connection: StatorTempConnection = .live,
        includeRearRight: Bool = true
    ) -> StatorTempUpdate {
        StatorTempUpdate(
            status: .loaded,
            snapshots: previewSnapshots(includeRearRight: includeRearRight),
            units: StatorTempUnitPrefs(temperature: unit),
            connection: connection,
            updatedAt: Date()
        )
    }

    @MainActor
    private func previewSurface(_ update: StatorTempUpdate) -> some View {
        ScrollView {
            StatorTempChart(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content (°C)") {
        previewSurface(loadedUpdate())
    }

    #Preview("Content (°F)") {
        previewSurface(loadedUpdate(unit: .fahrenheit))
    }

    #Preview("Front + rear-left only") {
        previewSurface(loadedUpdate(includeRearRight: false))
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(connection: .offline))
    }

    #Preview("Loading") {
        previewSurface(StatorTempUpdate(status: .loading))
    }

    #Preview("Empty (no snapshots)") {
        previewSurface(StatorTempUpdate(status: .loaded, snapshots: []))
    }

    #Preview("Empty (single snapshot)") {
        previewSurface(
            StatorTempUpdate(
                status: .loaded,
                snapshots: [StatorTempSnapshot(timestamp: Date(), frontC: 55, rearLeftC: 52, rearRightC: 49)]
            )
        )
    }

    #Preview("Error") {
        previewSurface(StatorTempUpdate(status: .failed("Network unavailable")))
    }
#endif
