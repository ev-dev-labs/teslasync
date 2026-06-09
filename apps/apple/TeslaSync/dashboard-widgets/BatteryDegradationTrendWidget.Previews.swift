//
//  BatteryDegradationTrendWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0012 · BatteryDegradationTrendWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + compact + single-point). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: 12 consecutive months of gently declining
    /// state-of-health ending at the current calendar month, so the trend line
    /// and the 80% reference rule both frame sensibly.
    private enum BatteryDegradationTrendPreviewData {
        static func rows(now: Date = Date()) -> [DegradationTrendRow] {
            let calendar = Calendar.current
            let health: [Double] = [98.4, 98.0, 97.5, 96.9, 96.2, 95.6, 95.1, 94.4, 93.8, 93.0, 92.3, 91.6]
            let range: [Double] = [505, 503, 500, 496, 492, 489, 486, 482, 478, 473, 469, 465]
            return health.enumerated().compactMap { index, soh in
                let offset = health.count - 1 - index
                guard let date = calendar.date(byAdding: .month, value: -offset, to: now) else { return nil }
                let components = calendar.dateComponents([.year, .month], from: date)
                guard let year = components.year, let month = components.month else { return nil }
                return DegradationTrendRow(
                    month: String(format: "%04d-%02d", year, month),
                    avgHealth: soh,
                    avgCapacity: 750 * soh / 100,
                    avgRange: range[index]
                )
            }
        }

        static let summary = DegradationSummary(
            currentHealthPct: 91.6,
            currentHealth: 91.6,
            degradationRatePctPerMonth: 0.62,
            currentCycles: 318
        )
    }

    @MainActor
    private func previewModel(_ update: BatteryDegradationTrendUpdate) -> BatteryDegradationTrendModel {
        let source = InMemoryBatteryDegradationTrendSource(initial: update)
        let model = BatteryDegradationTrendModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = DegradationVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: BatteryDegradationTrendPreviewData.rows(),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: BatteryDegradationTrendPreviewData.rows(),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 560, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Single point (needs more)") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: Array(BatteryDegradationTrendPreviewData.rows().suffix(1)),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        BatteryDegradationTrendWidget(model: previewModel(BatteryDegradationTrendUpdate(status: .loading)))
            .frame(width: 340, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(status: .loaded, vehicle: previewVehicle, rows: [])
            )
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        BatteryDegradationTrendWidget(
            model: previewModel(BatteryDegradationTrendUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    rows: BatteryDegradationTrendPreviewData.rows(),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    rows: BatteryDegradationTrendPreviewData.rows(),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        BatteryDegradationTrendWidget(
            model: previewModel(
                BatteryDegradationTrendUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: BatteryDegradationTrendPreviewData.rows(),
                    summary: BatteryDegradationTrendPreviewData.summary,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 180, height: 150)
        .padding()
        .background(Color.TS.bg)
    }
#endif
