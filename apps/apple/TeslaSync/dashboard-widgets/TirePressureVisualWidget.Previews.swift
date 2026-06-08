//
//  TirePressureVisualWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  Xcode previews for each surface state (content / warning / compact / empty /
//  loading / error / stale / offline). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TirePressureUpdate) -> TirePressureModel {
        let source = InMemoryTirePressureSource(initial: update)
        let model = TirePressureModel(source: source)
        model.start()
        return model
    }

    /// Four healthy tires (~2.4 bar → all green).
    private func normalReading(now: Date = Date()) -> TirePressureReading {
        TirePressureReading(
            frontLeftKilopascals: 241,
            frontRightKilopascals: 238,
            rearLeftKilopascals: 245,
            rearRightKilopascals: 243,
            lastSeenFrontLeft: now.addingTimeInterval(-30),
            lastSeenFrontRight: now.addingTimeInterval(-45),
            lastSeenRearLeft: now.addingTimeInterval(-90),
            lastSeenRearRight: now.addingTimeInterval(-60)
        )
    }

    /// Mixed fleet: FR soft (2.2 bar → amber), RL hard-low (2.0 bar → red).
    private func warningReading(now: Date = Date()) -> TirePressureReading {
        TirePressureReading(
            frontLeftKilopascals: 240,
            frontRightKilopascals: 220,
            rearLeftKilopascals: 200,
            rearRightKilopascals: 242,
            lastSeenFrontLeft: now.addingTimeInterval(-120),
            lastSeenFrontRight: now.addingTimeInterval(-3600),
            lastSeenRearLeft: now.addingTimeInterval(-7200),
            lastSeenRearRight: now.addingTimeInterval(-150)
        )
    }

    #Preview("Content — all normal") {
        TirePressureVisualWidget(
            model: previewModel(
                TirePressureUpdate(
                    status: .loaded,
                    connection: .live,
                    reading: normalReading(),
                    unit: .bar,
                    localeIdentifier: "en_US",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 280, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — check pressure (psi)") {
        TirePressureVisualWidget(
            model: previewModel(
                TirePressureUpdate(
                    status: .loaded,
                    connection: .live,
                    reading: warningReading(),
                    unit: .psi,
                    localeIdentifier: "en_US",
                    updatedAt: Date()
                )
            )
        )
        .frame(width: 280, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TirePressureVisualWidget(model: previewModel(TirePressureUpdate(status: .loaded, reading: nil)))
            .frame(width: 280, height: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TirePressureVisualWidget(model: previewModel(TirePressureUpdate(status: .loading, reading: nil)))
            .frame(width: 280, height: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TirePressureVisualWidget(
            model: previewModel(TirePressureUpdate(status: .failed("Network unavailable"), reading: nil))
        )
        .frame(width: 280, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        TirePressureVisualWidget(
            model: previewModel(
                TirePressureUpdate(
                    status: .loaded,
                    connection: .stale,
                    reading: normalReading(),
                    unit: .bar,
                    localeIdentifier: "en_US",
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 280, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        TirePressureVisualWidget(
            model: previewModel(
                TirePressureUpdate(
                    status: .loaded,
                    connection: .offline,
                    reading: warningReading(),
                    unit: .bar,
                    localeIdentifier: "en_US",
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 280, height: 340)
        .padding()
        .background(Color.TS.bg)
    }
#endif
