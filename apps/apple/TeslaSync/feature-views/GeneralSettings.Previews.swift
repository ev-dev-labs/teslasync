//
//  GeneralSettings.Previews.swift
//  TeslaSync — P4 feature view · 0207 · GeneralSettings (Apple)
//
//  Xcode previews for every General Settings render state — content / loading /
//  empty / error / stale / offline / recovered-draft — plus light + dark and a
//  large Dynamic Type pass, per the Apple HIG. DEBUG-only; the previews use a
//  no-op telemetry sink so rendering them never emits diagnostics, and an
//  in-memory source/draft store so they stay host-free.
//

import SwiftUI

#if DEBUG
    /// A telemetry sink that drops events — previews must not emit diagnostics.
    private struct NoopGeneralSettingsTelemetry: GeneralSettingsTelemetry {
        func viewOpened(surface _: String) {}
    }

    private enum GeneralSettingsPreviewData {
        static let loaded = AppSettingsState(
            unitOfLength: "mi", unitOfTemp: "F", unitOfPressure: "psi", preferredRange: "ideal",
            decimalPrecision: 2, language: "en", currencySymbol: "$", locale: "en-US",
            tzDisplayDefault: "vehicle", timezoneUser: "", baseCostPerKwh: 0.14,
            gasPricePerUnit: 3.79, gasUnit: "gallon", gasEfficiencyMpg: 27
        )

        static let carPrefs = CarPreferences(
            distanceUnit: "DistanceUnitMiles",
            temperatureUnit: "TemperatureUnitFahrenheit",
            tirePressureUnit: "PressureUnitPsi",
            clock24Hour: false
        )

        static let vehicles = [GeneralSettingsVehicleOption(id: 1, displayName: "Red Model 3")]

        static func snapshot(
            settings: SettingsQuery = .loaded(loaded),
            connection: SettingsConnection = .live,
            carPreferences: CarPreferences? = carPrefs,
            updatedAt: Date? = Date()
        ) -> GeneralSettingsSnapshot {
            GeneralSettingsSnapshot(
                settings: settings,
                vehicles: vehicles,
                carPreferences: carPreferences,
                connection: connection,
                updatedAt: updatedAt
            )
        }
    }

    @MainActor
    private func generalSettingsPreviewModel(
        _ snapshot: GeneralSettingsSnapshot,
        draft: AppSettingsState? = nil
    ) -> GeneralSettingsModel {
        let source = InMemoryGeneralSettingsSource(initial: snapshot)
        let store = InMemoryGeneralSettingsDraftStore(draft: draft)
        let model = GeneralSettingsModel(
            source: source,
            telemetry: NoopGeneralSettingsTelemetry(),
            draftStore: store
        )
        model.start()
        return model
    }

    #Preview("Content · Dark") {
        GeneralSettings(model: generalSettingsPreviewModel(GeneralSettingsPreviewData.snapshot()))
            .preferredColorScheme(.dark)
            .frame(width: 760, height: 980)
    }

    #Preview("Content · Light") {
        GeneralSettings(model: generalSettingsPreviewModel(GeneralSettingsPreviewData.snapshot()))
            .preferredColorScheme(.light)
            .frame(width: 760, height: 980)
    }

    #Preview("Loading") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(settings: .loading, carPreferences: nil, updatedAt: nil)
        ))
        .preferredColorScheme(.dark)
        .frame(width: 520, height: 640)
    }

    #Preview("Empty") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(settings: .empty, carPreferences: nil)
        ))
        .preferredColorScheme(.dark)
        .frame(width: 520, height: 640)
    }

    #Preview("Error") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(settings: .failed("Network unavailable"), carPreferences: nil)
        ))
        .preferredColorScheme(.dark)
        .frame(width: 520, height: 640)
    }

    #Preview("Stale") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(connection: .stale, updatedAt: Date().addingTimeInterval(-300))
        ))
        .preferredColorScheme(.dark)
        .frame(width: 760, height: 980)
    }

    #Preview("Offline (cached)") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(connection: .offline, updatedAt: Date().addingTimeInterval(-1800))
        ))
        .preferredColorScheme(.dark)
        .frame(width: 760, height: 980)
    }

    #Preview("Recovered draft") {
        GeneralSettings(model: generalSettingsPreviewModel(
            GeneralSettingsPreviewData.snapshot(),
            draft: {
                var draft = GeneralSettingsPreviewData.loaded
                draft.unitOfLength = "km"
                draft.currencySymbol = "€"
                return draft
            }()
        ))
        .preferredColorScheme(.dark)
        .frame(width: 760, height: 980)
    }

    #Preview("Dynamic Type · accessibility3") {
        GeneralSettings(model: generalSettingsPreviewModel(GeneralSettingsPreviewData.snapshot()))
            .environment(\.dynamicTypeSize, .accessibility3)
            .preferredColorScheme(.dark)
            .frame(width: 760, height: 1200)
    }
#endif
