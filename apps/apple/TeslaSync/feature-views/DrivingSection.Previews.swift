//
//  DrivingSection.Previews.swift
//  TeslaSync — P4 feature view · 0075 · DrivingSection (Apple)
//
//  #if DEBUG previews exercising every state the web source renders (content / loading / empty /
//  error / stale / offline) plus the two inner empty states (no daily distance, no top drive), so
//  the surface can be eyeballed in Xcode without the live store.
//

#if DEBUG
    import SwiftUI

    private enum DrivingSectionPreviewData {
        static let week: [DrivingDailyDistance] = [
            DrivingDailyDistance(day: "Mon", distanceKm: 32.4),
            DrivingDailyDistance(day: "Tue", distanceKm: 18.1),
            DrivingDailyDistance(day: "Wed", distanceKm: 47.6),
            DrivingDailyDistance(day: "Thu", distanceKm: 12.0),
            DrivingDailyDistance(day: "Fri", distanceKm: 58.9),
            DrivingDailyDistance(day: "Sat", distanceKm: 73.2),
            DrivingDailyDistance(day: "Sun", distanceKm: 5.5)
        ]

        static let topDrive = DrivingTopDrive(
            startDate: "2026-04-04T14:30:00Z",
            distanceKm: 73.2,
            durationMin: 64,
            efficiencyWhKm: 168.4
        )

        static let sample = DrivingDigestDTO(
            avgEfficiency: 172.5,
            prevAvgEfficiency: 181.0,
            totalDurationMin: 268,
            totalDrives: 9,
            topDrive: topDrive,
            dailyDistance: week
        )

        /// A resolved digest with empty daily bins + no top drive (exercises the two inner empties).
        static let sparse = DrivingDigestDTO(
            avgEfficiency: 0,
            prevAvgEfficiency: 0,
            totalDurationMin: 0,
            totalDrives: 0,
            topDrive: nil,
            dailyDistance: []
        )

        @MainActor
        static func model(_ update: DrivingSectionUpdate) -> DrivingSectionModel {
            DrivingSectionModel(
                source: InMemoryDrivingSectionSource(initial: update),
                copy: .fallback,
                locale: Locale(identifier: "en_US")
            )
        }

        static func loaded(
            _ data: DrivingDigestDTO = sample,
            connection: DrivingSectionConnection = .live
        ) -> DrivingSectionUpdate {
            DrivingSectionUpdate(status: .loaded, data: data, connection: connection, updatedAt: Date())
        }
    }

    private struct DrivingSectionPreviewStage: View {
        let model: DrivingSectionModel

        var body: some View {
            ScrollView {
                DrivingSection(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        DrivingSectionPreviewStage(model: DrivingSectionPreviewData.model(DrivingSectionPreviewData.loaded()))
    }

    #Preview("Inner empties (no bars / no top drive)") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(DrivingSectionPreviewData.loaded(DrivingSectionPreviewData.sparse))
        )
    }

    #Preview("Loading") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(DrivingSectionUpdate(status: .loading, data: nil))
        )
    }

    #Preview("Empty") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(DrivingSectionUpdate(status: .loaded, data: nil))
        )
    }

    #Preview("Error") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(
                DrivingSectionUpdate(status: .failed("Network unavailable"), data: nil)
            )
        )
    }

    #Preview("Stale") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(DrivingSectionPreviewData.loaded(connection: .stale))
        )
    }

    #Preview("Offline") {
        DrivingSectionPreviewStage(
            model: DrivingSectionPreviewData.model(DrivingSectionPreviewData.loaded(connection: .offline))
        )
    }
#endif
