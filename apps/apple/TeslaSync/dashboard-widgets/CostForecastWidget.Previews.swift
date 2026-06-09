//
//  CostForecastWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0032 · CostForecastWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + wide + narrow). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: four historical months + two forecast months,
    /// so the slice(-6) window, the trend (forecast rises above the last actual),
    /// and the historical→forecast legend all render.
    private enum CostForecastWidgetPreviewData {
        static let historical: [CostForecastWidgetHistoricalMonth] = [
            CostForecastWidgetHistoricalMonth(id: 1, month: "Dec", cost: 58.40, costPerKwh: 0.142),
            CostForecastWidgetHistoricalMonth(id: 2, month: "Jan", cost: 64.10, costPerKwh: 0.151),
            CostForecastWidgetHistoricalMonth(id: 3, month: "Feb", cost: 49.75, costPerKwh: 0.138),
            CostForecastWidgetHistoricalMonth(id: 4, month: "Mar", cost: 52.30, costPerKwh: 0.144)
        ]
        static let forecast: [CostForecastWidgetForecastMonth] = [
            CostForecastWidgetForecastMonth(id: 5, month: "Apr", cost: 61.90),
            CostForecastWidgetForecastMonth(id: 6, month: "May", cost: 67.20)
        ]
    }

    @MainActor
    private func previewModel(_ update: CostForecastWidgetUpdate) -> CostForecastWidgetModel {
        let source = InMemoryCostForecastWidgetSource(initial: update)
        let model = CostForecastWidgetModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = CostForecastWidgetVehicle(id: 1, displayName: "Model Y")

    private func loadedUpdate(
        connection: CostForecastWidgetConnection = .live,
        status: CostForecastWidgetLoadStatus = .loaded,
        updatedAt: Date? = Date()
    ) -> CostForecastWidgetUpdate {
        CostForecastWidgetUpdate(
            status: status,
            connection: connection,
            vehicle: previewVehicle,
            historical: CostForecastWidgetPreviewData.historical,
            forecast: CostForecastWidgetPreviewData.forecast,
            currencySymbol: "$",
            decimalPrecision: 2,
            localeIdentifier: "en_US",
            updatedAt: updatedAt
        )
    }

    #Preview("Content") {
        CostForecastWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        CostForecastWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 520, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        CostForecastWidget(model: previewModel(CostForecastWidgetUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        CostForecastWidget(
            model: previewModel(CostForecastWidgetUpdate(status: .loaded, vehicle: previewVehicle))
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        CostForecastWidget(model: previewModel(CostForecastWidgetUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        CostForecastWidget(
            model: previewModel(loadedUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-300))),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        CostForecastWidget(
            model: previewModel(
                loadedUpdate(
                    connection: .offline,
                    status: .failed("Offline"),
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Narrow (1-col)") {
        CostForecastWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 180, height: 260)
        .padding()
        .background(Color.TS.bg)
    }
#endif
