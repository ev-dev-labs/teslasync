//
//  WeatherAtCarWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0115 · WeatherAtCarWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale /
//  content) and each layout (compact / standard). DEBUG-only; skipped by the host compile +
//  format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func weatherPreviewModel(_ update: WeatherAtCarUpdate) -> WeatherAtCarModel {
        let source = InMemoryWeatherAtCarSource(initial: update)
        let model = WeatherAtCarModel(source: source)
        model.start()
        return model
    }

    private let weatherSampleState = WeatherStateDTO(
        outsideTempCelsius: 21.6,
        latitude: 37.4221,
        longitude: -122.0841
    )

    private let weatherFahrenheitUnits = WeatherUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")

    #Preview("Compact (1×1)") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(
                    status: .loaded,
                    connection: .live,
                    state: WeatherStateDTO(outsideTempCelsius: -3),
                    units: WeatherUnitPrefs(temperature: .celsius, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 1)
        )
        .frame(width: 132, height: 132)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Standard (1×2)") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(
                    status: .loaded,
                    connection: .live,
                    state: weatherSampleState,
                    units: WeatherUnitPrefs(temperature: .celsius, localeIdentifier: "en_US"),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (3×2) °F") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(
                    status: .loaded,
                    connection: .live,
                    state: WeatherStateDTO(outsideTempCelsius: 31.2, latitude: 34.05, longitude: -118.24),
                    units: weatherFahrenheitUnits,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2)
        )
        .frame(width: 420, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(WeatherAtCarUpdate(status: .loading, state: nil)),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(status: .loaded, state: WeatherStateDTO(outsideTempCelsius: nil))
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(status: .failed("Network unavailable"), state: nil)
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    state: weatherSampleState,
                    units: WeatherUnitPrefs(temperature: .celsius, localeIdentifier: "en_US"),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 3, rows: 2)
        )
        .frame(width: 420, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WeatherAtCarWidget(
            model: weatherPreviewModel(
                WeatherAtCarUpdate(
                    status: .loaded,
                    connection: .offline,
                    state: weatherSampleState,
                    units: weatherFahrenheitUnits,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 220)
        .padding()
        .background(Color.TS.bg)
    }
#endif
