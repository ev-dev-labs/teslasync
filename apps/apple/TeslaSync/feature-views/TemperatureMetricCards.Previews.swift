//
//  TemperatureMetricCards.Previews.swift
//  TeslaSync — P4 feature view · 0161 · TemperatureMetricCards (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale / offline)
//  across Celsius + Fahrenheit temperature preferences. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: TemperatureMetricsUpdate) -> TemperatureMetricCardsModel {
        let source = InMemoryTemperatureMetricsSource(initial: update)
        let model = TemperatureMetricCardsModel(source: source)
        model.start()
        return model
    }

    /// Representative drivetrain readings — the shape the web reads from
    /// `health.{front,rear}MotorTempC` / `inverterTempC` / `batteryTempC` (°C) plus the derived
    /// health verdict + score and the peak drive power (kW).
    private func previewInput(_ health: DrivetrainHealthStatus = .warning) -> TemperatureMetricsInput {
        TemperatureMetricsInput(
            frontMotorTempC: 98.0,
            rearMotorTempC: 132.0,
            inverterTempC: 71.5,
            batteryTempC: 34.0,
            overallHealth: health,
            healthScore: health.score,
            peakPowerKw: 285
        )
    }

    private func loadedUpdate(
        prefs: TemperatureMetricsUnitPrefs,
        connection: TemperatureMetricsConnection = .live
    ) -> TemperatureMetricsUpdate {
        TemperatureMetricsUpdate(
            status: .loaded,
            input: previewInput(),
            unitPrefs: prefs,
            connection: connection,
            updatedAt: Date()
        )
    }

    private let celsiusPrefs = TemperatureMetricsUnitPrefs(temperature: .celsius, localeIdentifier: "en_US")
    private let fahrenheitPrefs = TemperatureMetricsUnitPrefs(temperature: .fahrenheit, localeIdentifier: "en_US")

    @MainActor
    private func previewSurface(_ update: TemperatureMetricsUpdate) -> some View {
        ScrollView {
            TemperatureMetricCards(model: previewModel(update))
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Content · Celsius") {
        previewSurface(loadedUpdate(prefs: celsiusPrefs))
    }

    #Preview("Content · Fahrenheit") {
        previewSurface(loadedUpdate(prefs: fahrenheitPrefs))
    }

    #Preview("Empty") {
        previewSurface(TemperatureMetricsUpdate(status: .empty, input: nil, unitPrefs: celsiusPrefs))
    }

    #Preview("Loading") {
        previewSurface(TemperatureMetricsUpdate(status: .loading, input: nil, unitPrefs: celsiusPrefs))
    }

    #Preview("Error") {
        previewSurface(
            TemperatureMetricsUpdate(status: .failed("Network unavailable"), input: nil, unitPrefs: celsiusPrefs)
        )
    }

    #Preview("Stale (cached)") {
        previewSurface(loadedUpdate(prefs: celsiusPrefs, connection: .stale))
    }

    #Preview("Offline (cached)") {
        previewSurface(loadedUpdate(prefs: fahrenheitPrefs, connection: .offline))
    }
#endif
