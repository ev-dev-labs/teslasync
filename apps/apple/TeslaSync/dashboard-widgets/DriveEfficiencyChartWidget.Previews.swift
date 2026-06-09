//
//  DriveEfficiencyChartWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + wide·mi). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// One synthetic drive: `daysAgo` days back, `km` long, consuming `whPerKm`.
    private struct PreviewDrive {
        let daysAgo: Int
        let km: Double
        let whPerKm: Double
    }

    /// Deterministic sample drives spread across the last 30 days, each with a
    /// plausible Wh/km so the daily + rolling-average series both render.
    private enum DriveEfficiencyPreviewData {
        private static let samples: [PreviewDrive] = [
            PreviewDrive(daysAgo: 28, km: 18, whPerKm: 158),
            PreviewDrive(daysAgo: 27, km: 24, whPerKm: 171),
            PreviewDrive(daysAgo: 25, km: 12, whPerKm: 149),
            PreviewDrive(daysAgo: 24, km: 30, whPerKm: 184),
            PreviewDrive(daysAgo: 22, km: 21, whPerKm: 142),
            PreviewDrive(daysAgo: 21, km: 16, whPerKm: 165),
            PreviewDrive(daysAgo: 19, km: 27, whPerKm: 176),
            PreviewDrive(daysAgo: 18, km: 14, whPerKm: 151),
            PreviewDrive(daysAgo: 16, km: 33, whPerKm: 168),
            PreviewDrive(daysAgo: 15, km: 19, whPerKm: 139),
            PreviewDrive(daysAgo: 13, km: 22, whPerKm: 160),
            PreviewDrive(daysAgo: 12, km: 25, whPerKm: 173),
            PreviewDrive(daysAgo: 10, km: 17, whPerKm: 147),
            PreviewDrive(daysAgo: 9, km: 29, whPerKm: 181),
            PreviewDrive(daysAgo: 7, km: 20, whPerKm: 155),
            PreviewDrive(daysAgo: 6, km: 23, whPerKm: 162),
            PreviewDrive(daysAgo: 4, km: 15, whPerKm: 144),
            PreviewDrive(daysAgo: 3, km: 31, whPerKm: 178),
            PreviewDrive(daysAgo: 1, km: 26, whPerKm: 152),
            PreviewDrive(daysAgo: 0, km: 18, whPerKm: 149)
        ]

        static func drives(now: Date = Date()) -> [DriveEfficiencySample] {
            samples.compactMap { sample in
                guard let date = Calendar.current.date(
                    byAdding: .day, value: -sample.daysAgo, to: now
                ) else { return nil }
                let iso = ISO8601DateFormatter().string(from: date)
                return DriveEfficiencySample(
                    startTs: iso,
                    distanceM: sample.km * 1000,
                    startSocPct: 80,
                    endSocPct: 80 - (sample.whPerKm * sample.km / 750),
                    energyUsedWh: sample.whPerKm * sample.km
                )
            }
        }
    }

    @MainActor
    private func previewModel(_ update: DriveEfficiencyChartUpdate) -> DriveEfficiencyChartModel {
        let source = InMemoryDriveEfficiencyChartSource(initial: update)
        let model = DriveEfficiencyChartModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = DriveEfficiencyVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        DriveEfficiencyChartWidget(
            model: previewModel(
                DriveEfficiencyChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    drives: DriveEfficiencyPreviewData.drives(),
                    distanceUnit: "km",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide · mi)") {
        DriveEfficiencyChartWidget(
            model: previewModel(
                DriveEfficiencyChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    drives: DriveEfficiencyPreviewData.drives(),
                    distanceUnit: "mi",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 560, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DriveEfficiencyChartWidget(model: previewModel(DriveEfficiencyChartUpdate(status: .loading)))
            .frame(width: 340, height: 340)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DriveEfficiencyChartWidget(
            model: previewModel(DriveEfficiencyChartUpdate(status: .loaded, vehicle: previewVehicle, drives: []))
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DriveEfficiencyChartWidget(
            model: previewModel(DriveEfficiencyChartUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DriveEfficiencyChartWidget(
            model: previewModel(
                DriveEfficiencyChartUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    drives: DriveEfficiencyPreviewData.drives(),
                    distanceUnit: "km",
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DriveEfficiencyChartWidget(
            model: previewModel(
                DriveEfficiencyChartUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    drives: DriveEfficiencyPreviewData.drives(),
                    distanceUnit: "km",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 340, height: 340)
        .padding()
        .background(Color.TS.bg)
    }
#endif
