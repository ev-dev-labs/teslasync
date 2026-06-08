//
//  DriveAnalyticsSection.Previews.swift
//  TeslaSync — P4 feature view · 0166 · DriveAnalyticsSection (Apple)
//
//  #if DEBUG previews exercising every state the web source renders (content / loading / empty / error /
//  stale / offline) plus the inner per-chart empties (drives present but no speed / no power), so the
//  surface can be eyeballed in Xcode without the live store.
//

#if DEBUG
    import SwiftUI

    private enum DriveAnalyticsSectionPreviewData {
        static let window: ClosedRange<Date> = {
            let end = Date(timeIntervalSince1970: 1_775_000_000)
            let start = end.addingTimeInterval(-30 * 86400)
            return start ... end
        }()

        /// A full set of drives spanning the speed buckets, with peak-power readings.
        static let drives: [DriveAnalyticsSectionDrive] = (0 ..< 14).map { index in
            DriveAnalyticsSectionDrive(
                id: index,
                startTs: timestamp(dayOffset: index),
                distanceM: Double(4000 + index * 5200),
                avgSpeedMps: Double(8 + index * 7),
                avgPowerW: Double(9000 + index * 2300)
            )
        }

        /// Drives present but with neither speed nor power → both inner empties render.
        static let driveless: [DriveAnalyticsSectionDrive] = (0 ..< 4).map { index in
            DriveAnalyticsSectionDrive(
                id: index,
                startTs: timestamp(dayOffset: index),
                distanceM: Double(6000 + index * 1000),
                avgSpeedMps: nil,
                avgPowerW: nil
            )
        }

        static func data(_ drives: [DriveAnalyticsSectionDrive]) -> DriveAnalyticsSectionData {
            DriveAnalyticsSectionData(
                drives: drives,
                units: .metric,
                rangeStart: window.lowerBound,
                rangeEnd: window.upperBound
            )
        }

        static func timestamp(dayOffset: Int) -> String {
            let base = Date(timeIntervalSince1970: 1_775_000_000)
            let date = base.addingTimeInterval(Double(dayOffset) * 86400)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: date)
        }

        @MainActor
        static func model(_ update: DriveAnalyticsSectionUpdate) -> DriveAnalyticsSectionModel {
            DriveAnalyticsSectionModel(
                source: InMemoryDriveAnalyticsSectionSource(initial: update),
                copy: .fallback,
                locale: Locale(identifier: "en_US"),
                timeZone: TimeZone(identifier: "UTC") ?? .current,
                initialRange: window
            )
        }

        static func loaded(
            _ drives: [DriveAnalyticsSectionDrive] = drives,
            connection: DriveAnalyticsSectionConnection = .live
        ) -> DriveAnalyticsSectionUpdate {
            DriveAnalyticsSectionUpdate(
                status: .loaded,
                data: data(drives),
                connection: connection,
                updatedAt: Date()
            )
        }
    }

    private struct DriveAnalyticsSectionPreviewStage: View {
        let model: DriveAnalyticsSectionModel

        var body: some View {
            ScrollView {
                DriveAnalyticsSection(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(DriveAnalyticsSectionPreviewData.loaded())
        )
    }

    #Preview("Inner empties (no speed / no power)") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(
                DriveAnalyticsSectionPreviewData.loaded(DriveAnalyticsSectionPreviewData.driveless)
            )
        )
    }

    #Preview("Loading") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(DriveAnalyticsSectionUpdate(status: .loading, data: nil))
        )
    }

    #Preview("Empty") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(
                DriveAnalyticsSectionPreviewData.loaded([])
            )
        )
    }

    #Preview("Error") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(
                DriveAnalyticsSectionUpdate(status: .failed("Network unavailable"), data: nil)
            )
        )
    }

    #Preview("Stale") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(
                DriveAnalyticsSectionPreviewData.loaded(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        DriveAnalyticsSectionPreviewStage(
            model: DriveAnalyticsSectionPreviewData.model(
                DriveAnalyticsSectionPreviewData.loaded(connection: .offline)
            )
        )
    }
#endif
