//
//  ChargeHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  Xcode previews for each surface state (content/wide/loading/empty/single-session
//  empty/error/stale/offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: 8 recent charge sessions newest-first (the order
    /// the API returns), with varied energy so the area trend has shape.
    private enum ChargeHistoryPreviewData {
        static func rows() -> [ChargeHistorySessionDTO] {
            let wattHours: [Double] = [47300, 11200, 62500, 9800, 18400, 54100, 10500, 21900]
            return wattHours.enumerated().map { index, wh in
                ChargeHistorySessionDTO(id: 1000 + index, totalEnergyAddedWh: wh)
            }
        }
    }

    @MainActor
    private func previewModel(_ update: ChargeHistoryChartUpdate) -> ChargeHistoryChartModel {
        let source = InMemoryChargeHistoryChartSource(initial: update)
        let model = ChargeHistoryChartModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = ChargeHistoryVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        ChargeHistoryWidget(
            model: previewModel(
                ChargeHistoryChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: ChargeHistoryPreviewData.rows(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        ChargeHistoryWidget(
            model: previewModel(
                ChargeHistoryChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: ChargeHistoryPreviewData.rows(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 520, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargeHistoryWidget(model: previewModel(ChargeHistoryChartUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargeHistoryWidget(
            model: previewModel(ChargeHistoryChartUpdate(status: .loaded, vehicle: previewVehicle, rows: []))
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    // A single session still reads as empty — the web `hasData = chartData.length > 1`
    // requires at least two points before the trend is shown.
    #Preview("Empty (single session)") {
        ChargeHistoryWidget(
            model: previewModel(
                ChargeHistoryChartUpdate(
                    status: .loaded,
                    vehicle: previewVehicle,
                    rows: [ChargeHistorySessionDTO(id: 1, totalEnergyAddedWh: 47300)]
                )
            )
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargeHistoryWidget(model: previewModel(ChargeHistoryChartUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ChargeHistoryWidget(
            model: previewModel(
                ChargeHistoryChartUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    rows: ChargeHistoryPreviewData.rows(),
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargeHistoryWidget(
            model: previewModel(
                ChargeHistoryChartUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    rows: ChargeHistoryPreviewData.rows(),
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
