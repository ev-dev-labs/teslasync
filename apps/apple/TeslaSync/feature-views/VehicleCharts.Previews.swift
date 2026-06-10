//
//  VehicleCharts.Previews.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  Xcode previews for each surface state (content / speed-only / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope. The sample slice here is shaped like the web
//  props (`state` / `positions` / `vehicleConfigData` / `userPrefData`) and is
//  reused as the tests' hand fixtures.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Representative slices for previews/tests (no network), shaped like the web props.
    enum VehicleChartsSample {
        static func date(_ iso: String) -> Date {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: iso) ?? Date(timeIntervalSince1970: 1_700_000_000)
        }

        static let state = VehicleChartsStateRecord(latitude: 37.4002, longitude: -122.078)

        /// A short drive trail with SI (m/s) speeds — newest-first, like the API.
        static let positions: [VehicleChartsPositionRecord] = [
            position(1, "2026-04-04T14:09:00Z", 37.4031, -122.081, 29.1),
            position(2, "2026-04-04T14:08:00Z", 37.4025, -122.080, 26.4),
            position(3, "2026-04-04T14:07:00Z", 37.4018, -122.079, 22.0),
            position(4, "2026-04-04T14:06:00Z", 37.4010, -122.0785, 13.4),
            position(5, "2026-04-04T14:05:00Z", 37.4002, -122.078, 0.0)
        ]

        static func position(
            _ id: Int,
            _ ts: String,
            _ lat: Double,
            _ lng: Double,
            _ speedMps: Double
        ) -> VehicleChartsPositionRecord {
            VehicleChartsPositionRecord(id: id, timestamp: date(ts), latitude: lat, longitude: lng, speedMps: speedMps)
        }

        static let config = VehicleChartsConfig(
            carType: "Model Y",
            trim: "Long Range",
            exteriorColor: "Pearl White",
            roofColor: "Glass",
            wheelType: "Induction 19\"",
            version: "2026.8.1",
            vehicleName: "Bolt",
            chargePort: "US",
            rearSeatHeaters: "1",
            efficiencyPackage: "Default",
            sunroofInstalled: nil,
            europeVehicle: false,
            rightHandDrive: false,
            remoteStartEnabled: true,
            offroadLightbarPresent: false,
            softwareUpdateVersion: nil,
            softwareUpdateDownloadPct: 100,
            softwareUpdateInstallPct: 45
        )

        static let preferences = VehicleChartsPreferences(
            setting24hrTime: true,
            settingChargeUnit: "ChargeUnitPercent",
            settingDistanceUnit: "DistanceUnitMiles",
            settingTemperatureUnit: "TemperatureUnitFahrenheit",
            settingTirePressureUnit: "PressureUnitPsi"
        )

        static let full = VehicleChartsData(
            state: state,
            positions: positions,
            config: config,
            preferences: preferences
        )

        static let speedOnly = VehicleChartsData(positions: positions)

        @MainActor
        static func model(_ update: VehicleChartsUpdate) -> VehicleChartsModel {
            let source = InMemoryVehicleChartsSource(initial: update)
            let model = VehicleChartsModel(source: source)
            model.start()
            return model
        }

        static func shell(_ view: VehicleCharts) -> some View {
            ScrollView {
                view.padding(TSSpacing.lg)
            }
            .frame(maxWidth: 900)
            .background(Color.TS.bg)
        }
    }

    #Preview("Content · full") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(
                    VehicleChartsUpdate(status: .loaded, data: VehicleChartsSample.full, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Content · speed only") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(
                    VehicleChartsUpdate(status: .loaded, data: VehicleChartsSample.speedOnly, updatedAt: Date())
                )
            )
        )
    }

    #Preview("Empty") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(VehicleChartsUpdate(status: .loaded, data: .empty))
            )
        )
    }

    #Preview("Loading") {
        VehicleChartsSample.shell(
            VehicleCharts(model: VehicleChartsSample.model(VehicleChartsUpdate(status: .loading)))
        )
    }

    #Preview("Error") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(VehicleChartsUpdate(status: .failed("Network unavailable")))
            )
        )
    }

    #Preview("Stale (cached)") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(
                    VehicleChartsUpdate(
                        status: .loaded,
                        connection: .stale,
                        data: VehicleChartsSample.full,
                        updatedAt: Date().addingTimeInterval(-180)
                    )
                )
            )
        )
    }

    #Preview("Offline (cached)") {
        VehicleChartsSample.shell(
            VehicleCharts(
                model: VehicleChartsSample.model(
                    VehicleChartsUpdate(
                        status: .loaded,
                        connection: .offline,
                        data: VehicleChartsSample.full,
                        updatedAt: Date().addingTimeInterval(-600)
                    )
                )
            )
        )
    }
#endif
