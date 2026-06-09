//
//  ChargingSessionDetailWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0024 · ChargingSessionDetailWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / compact / empty /
//  no-telemetry / loading / error / offline / stale). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ChargingSessionDetailUpdate) -> ChargingSessionDetailModel {
        let source = InMemoryChargingSessionDetailSource(initial: update)
        let model = ChargingSessionDetailModel(source: source)
        model.start()
        return model
    }

    private let previewDetail = ChargingSessionDetailInput(
        energyAddedWh: 42300,
        durationS: 3900,
        chargerType: "Tesla Supercharger V3"
    )

    /// A synthetic Supercharger curve: power ramps to a peak then tapers as the SoC
    /// climbs from ~20% to ~80% — the classic charging shape.
    private func previewSamples(now: Date = Date()) -> [ChargingSessionDetailSampleInput] {
        func sample(_ minutesAgo: Double, power: Double, soc: Double) -> ChargingSessionDetailSampleInput {
            ChargingSessionDetailSampleInput(
                timestamp: now.addingTimeInterval(-minutesAgo * 60),
                powerW: power,
                socPercent: soc
            )
        }
        return [
            sample(65, power: 18000, soc: 18),
            sample(58, power: 95000, soc: 24),
            sample(50, power: 168_000, soc: 33),
            sample(42, power: 192_000, soc: 42),
            sample(34, power: 170_000, soc: 52),
            sample(26, power: 120_000, soc: 61),
            sample(18, power: 78000, soc: 69),
            sample(10, power: 46000, soc: 75),
            sample(2, power: 22000, soc: 80)
        ]
    }

    #Preview("Content (2×4)") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(
                    status: .loaded,
                    connection: .live,
                    detail: previewDetail,
                    samples: previewSamples(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(
                    status: .loaded,
                    detail: previewDetail,
                    samples: previewSamples(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 600, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(status: .loaded, detail: previewDetail, samples: previewSamples())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no sessions)") {
        ChargingSessionDetailWidget(
            model: previewModel(ChargingSessionDetailUpdate(status: .loaded, detail: nil, samples: []))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No telemetry yet") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(
                    status: .loaded,
                    detail: ChargingSessionDetailInput(energyAddedWh: 1200, durationS: 240, chargerType: nil),
                    samples: []
                )
            )
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargingSessionDetailWidget(
            model: previewModel(ChargingSessionDetailUpdate(status: .loading, detail: nil, samples: []))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargingSessionDetailWidget(
            model: previewModel(ChargingSessionDetailUpdate(
                status: .failed("Network unavailable"),
                detail: nil,
                samples: []
            ))
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(
                    status: .loaded,
                    connection: .offline,
                    detail: previewDetail,
                    samples: previewSamples(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ChargingSessionDetailWidget(
            model: previewModel(
                ChargingSessionDetailUpdate(
                    status: .loaded,
                    connection: .stale,
                    detail: previewDetail,
                    samples: previewSamples(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 340, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
