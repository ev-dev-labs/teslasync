//
//  WeeklyDigestWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0116 · WeeklyDigestWidget (Apple)
//
//  #if DEBUG previews exercising every state the web source renders (content / loading / empty /
//  error / stale / offline) across the default and compact grid sizes, so the surface can be
//  eyeballed in Xcode without the live store.
//

#if DEBUG
    import SwiftUI

    private enum WeeklyDigestPreviewData {
        static let sample = WeeklyDigestDTO(
            drives: 12,
            distanceKm: 100,
            energyKwh: 45.6,
            efficiency: 250,
            prevDrives: 10,
            prevDistanceKm: 80,
            prevEnergyKwh: 45.6,
            prevEfficiency: 240
        )

        @MainActor
        static func model(_ update: WeeklyDigestUpdate) -> WeeklyDigestModel {
            WeeklyDigestModel(source: InMemoryWeeklyDigestSource(initial: update))
        }

        static func loaded(
            connection: WeeklyDigestConnection = .live,
            distance: WeeklyDigestDistanceUnit = .miles
        ) -> WeeklyDigestUpdate {
            WeeklyDigestUpdate(
                status: .loaded,
                connection: connection,
                data: sample,
                units: WeeklyDigestUnitPrefs(distance: distance, localeIdentifier: "en_US"),
                updatedAt: Date()
            )
        }
    }

    #Preview("Content · miles · 2×4") {
        WeeklyDigestWidget(model: WeeklyDigestPreviewData.model(WeeklyDigestPreviewData.loaded()))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · km · 2×4") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestPreviewData.loaded(distance: .kilometers))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact · 1×2") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestPreviewData.loaded()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 168, height: 200)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestUpdate(status: .loading, data: nil))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestUpdate(status: .empty, data: nil))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(
                WeeklyDigestUpdate(status: .failed("Network unavailable"), data: nil)
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestPreviewData.loaded(connection: .stale))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        WeeklyDigestWidget(
            model: WeeklyDigestPreviewData.model(WeeklyDigestPreviewData.loaded(connection: .offline))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
