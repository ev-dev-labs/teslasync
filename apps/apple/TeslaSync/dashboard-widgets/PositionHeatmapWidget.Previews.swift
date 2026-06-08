//
//  PositionHeatmapWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/offline/content +
//  the wide layout). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum PositionHeatmapPreviewData {
        /// Three SF-area clusters of decreasing density, so the blobs span the
        /// cool→hot intensity ramp.
        static func samplePositions() -> [HeatPosition] {
            var positions: [HeatPosition] = []
            positions.append(contentsOf: jittered(around: 37.7749, -122.4194, count: 40))
            positions.append(contentsOf: jittered(around: 37.7869, -122.4094, count: 16))
            positions.append(contentsOf: jittered(around: 37.7649, -122.4294, count: 5))
            return positions
        }

        private static func jittered(around lat: Double, _ lon: Double, count: Int) -> [HeatPosition] {
            (0 ..< count).map { _ in
                HeatPosition(
                    latitude: lat + Double.random(in: -0.0025 ... 0.0025),
                    longitude: lon + Double.random(in: -0.0025 ... 0.0025)
                )
            }
        }
    }

    @MainActor
    private func previewModel(_ update: PositionHeatmapUpdate) -> PositionHeatmapModel {
        let source = InMemoryPositionHeatmapSource(initial: update)
        let model = PositionHeatmapModel(source: source)
        model.start()
        return model
    }

    #Preview("Content · 2×4") {
        PositionHeatmapWidget(
            model: previewModel(
                PositionHeatmapUpdate(
                    status: .loaded,
                    connection: .live,
                    positions: PositionHeatmapPreviewData.samplePositions(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · 4-wide") {
        PositionHeatmapWidget(
            model: previewModel(
                PositionHeatmapUpdate(
                    status: .loaded,
                    connection: .live,
                    positions: PositionHeatmapPreviewData.samplePositions(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6),
            onOpen: {}
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        PositionHeatmapWidget(model: previewModel(PositionHeatmapUpdate(status: .loading)))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        PositionHeatmapWidget(model: previewModel(PositionHeatmapUpdate(status: .loaded, positions: [])))
            .frame(width: 280, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        PositionHeatmapWidget(
            model: previewModel(PositionHeatmapUpdate(status: .failed("Network unavailable"), positions: []))
        )
        .frame(width: 280, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        PositionHeatmapWidget(
            model: previewModel(
                PositionHeatmapUpdate(
                    status: .loaded,
                    connection: .offline,
                    positions: PositionHeatmapPreviewData.samplePositions(),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 5)
        )
        .frame(width: 440, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
