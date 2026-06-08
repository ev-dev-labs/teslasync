//
//  MonthlyMileageWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + compact). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: 12 consecutive months ending at the current
    /// calendar month so the highlighted "current" bar always renders.
    private enum MonthlyMileagePreviewData {
        static func rows(now: Date = Date()) -> [MileageMonthRow] {
            let calendar = Calendar.current
            let samples: [Double] = [820, 1040, 760, 1180, 1320, 980, 1410, 1260, 1505, 1120, 1380, 640]
            return samples.enumerated().compactMap { index, km in
                let offset = samples.count - 1 - index
                guard let date = calendar.date(byAdding: .month, value: -offset, to: now) else { return nil }
                let components = calendar.dateComponents([.year, .month], from: date)
                guard let year = components.year, let month = components.month else { return nil }
                return MileageMonthRow(
                    yearMonth: String(format: "%04d-%02d", year, month),
                    driveCount: Int(km / 40),
                    totalKm: km
                )
            }
        }
    }

    @MainActor
    private func previewModel(_ update: MonthlyMileageUpdate) -> MonthlyMileageModel {
        let source = InMemoryMonthlyMileageSource(initial: update)
        let model = MonthlyMileageModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = MileageVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        MonthlyMileageWidget(
            model: previewModel(
                MonthlyMileageUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: MonthlyMileagePreviewData.rows(),
                    distanceUnit: "km",
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

    #Preview("Content (wide · mi)") {
        MonthlyMileageWidget(
            model: previewModel(
                MonthlyMileageUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: MonthlyMileagePreviewData.rows(),
                    distanceUnit: "mi",
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
        MonthlyMileageWidget(model: previewModel(MonthlyMileageUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        MonthlyMileageWidget(
            model: previewModel(MonthlyMileageUpdate(status: .loaded, vehicle: previewVehicle, rows: []))
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        MonthlyMileageWidget(model: previewModel(MonthlyMileageUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        MonthlyMileageWidget(
            model: previewModel(
                MonthlyMileageUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    rows: MonthlyMileagePreviewData.rows(),
                    distanceUnit: "km",
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
        MonthlyMileageWidget(
            model: previewModel(
                MonthlyMileageUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    rows: MonthlyMileagePreviewData.rows(),
                    distanceUnit: "km",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact") {
        MonthlyMileageWidget(
            model: previewModel(
                MonthlyMileageUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: MonthlyMileagePreviewData.rows(),
                    distanceUnit: "km",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 170, height: 200)
        .padding()
        .background(Color.TS.bg)
    }
#endif
