//
//  SpeedHeatmapWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content) across the standard 2×4, wide 3×4, and compact 1×4
//  layouts. DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// A fixed Gregorian calendar so the sample drives bucket deterministically
    /// in previews (locale en_US, current zone).
    private let previewCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }()

    /// Builds a start instant for a Mon-first day (0=Mon … 6=Sun) and hour, based
    /// on 2024-01-01 (a Monday).
    private func previewDate(day: Int, hour: Int) -> Date {
        var components = DateComponents()
        components.year = 2024
        components.month = 1
        components.day = 1 + day
        components.hour = hour
        return previewCalendar.date(from: components) ?? Date()
    }

    /// One seeded slot for the preview heatmap (day×hour, speed, repeat count).
    private struct PreviewSlot {
        let day: Int
        let hour: Int
        let mps: Double
        let repeats: Int
    }

    /// A spread of drives across the week with rising speeds toward weekday rush
    /// hours, so the heatmap shows a full Slow→Fast ramp.
    private func previewDrives() -> [SpeedHeatmapDrive] {
        var drives: [SpeedHeatmapDrive] = []
        let slots: [PreviewSlot] = [
            PreviewSlot(day: 0, hour: 8, mps: 9, repeats: 3),
            PreviewSlot(day: 0, hour: 17, mps: 27, repeats: 4),
            PreviewSlot(day: 1, hour: 8, mps: 12, repeats: 2),
            PreviewSlot(day: 1, hour: 18, mps: 30, repeats: 5),
            PreviewSlot(day: 2, hour: 7, mps: 15, repeats: 2),
            PreviewSlot(day: 2, hour: 19, mps: 22, repeats: 3),
            PreviewSlot(day: 3, hour: 9, mps: 18, repeats: 2),
            PreviewSlot(day: 3, hour: 17, mps: 33, repeats: 4),
            PreviewSlot(day: 4, hour: 8, mps: 11, repeats: 3),
            PreviewSlot(day: 4, hour: 16, mps: 25, repeats: 3),
            PreviewSlot(day: 5, hour: 11, mps: 20, repeats: 2),
            PreviewSlot(day: 5, hour: 14, mps: 8, repeats: 2),
            PreviewSlot(day: 6, hour: 10, mps: 6, repeats: 1),
            PreviewSlot(day: 6, hour: 13, mps: 17, repeats: 2)
        ]
        for slot in slots {
            for _ in 0 ..< slot.repeats {
                drives.append(
                    SpeedHeatmapDrive(
                        startDate: previewDate(day: slot.day, hour: slot.hour),
                        avgSpeedMps: slot.mps,
                        maxSpeedMps: slot.mps + 5
                    )
                )
            }
        }
        return drives
    }

    private func previewModel(_ update: SpeedHeatmapUpdate) -> SpeedHeatmapModel {
        let source = InMemorySpeedHeatmapSource(initial: update)
        let model = SpeedHeatmapModel(source: source, calendar: previewCalendar)
        model.start()
        return model
    }

    private let previewVehicle = SpeedHeatmapVehicleRef(id: 1, displayName: "Model Y")

    private func loadedUpdate(
        connection: SpeedHeatmapConnection = .live,
        unitLabel: String = "mph",
        updatedAt: Date? = Date()
    ) -> SpeedHeatmapUpdate {
        SpeedHeatmapUpdate(
            status: .loaded,
            connection: connection,
            vehicle: previewVehicle,
            drives: previewDrives(),
            speedUnitLabel: unitLabel,
            updatedAt: updatedAt
        )
    }

    #Preview("Content · standard (mph)") {
        SpeedHeatmapWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · wide (km/h)") {
        SpeedHeatmapWidget(
            model: previewModel(loadedUpdate(unitLabel: "km/h")),
            size: DashboardWidgetSize(cols: 3, rows: 4),
            onOpen: {}
        )
        .frame(width: 460, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · compact (mph)") {
        SpeedHeatmapWidget(
            model: previewModel(loadedUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 160, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SpeedHeatmapWidget(model: previewModel(SpeedHeatmapUpdate(status: .loading)))
            .frame(width: 320, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SpeedHeatmapWidget(model: previewModel(SpeedHeatmapUpdate(status: .loaded)))
            .frame(width: 320, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SpeedHeatmapWidget(model: previewModel(SpeedHeatmapUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SpeedHeatmapWidget(
            model: previewModel(loadedUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-300))),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SpeedHeatmapWidget(
            model: previewModel(
                SpeedHeatmapUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    drives: previewDrives(),
                    speedUnitLabel: "km/h",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }
#endif
