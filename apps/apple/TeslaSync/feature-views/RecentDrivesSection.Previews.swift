//
//  RecentDrivesSection.Previews.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated table), content
//  with pagination (more than one page), empty (resolved with no rows), loading (initial
//  spinner), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentRecentDrivesTelemetry: RecentDrivesTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample drives spanning distances, durations, and SOC pairs (one with a missing end SOC,
    /// so the Battery em-dash branch renders).
    private enum RecentDrivesPreviewData {
        static func items(count: Int = 4) -> [RecentDriveItem] {
            let base = Date(timeIntervalSince1970: 1_717_000_000)
            return (0 ..< count).map { index in
                let itemID = Int64(index + 1)
                let start = base.addingTimeInterval(Double(-index) * 7200)
                let distance = Double((index % 7) + 1) * 8540
                let duration = Double((index % 5) + 1) * 1080
                let startSOC: Double = 82 - Double(index % 30)
                let endSOC: Double? = index == 1 ? nil : 64 - Double(index % 20)
                return RecentDriveItem(
                    id: itemID,
                    startTimestamp: start,
                    distanceMeters: distance,
                    durationSeconds: duration,
                    startBatteryPercent: startSOC,
                    endBatteryPercent: endSOC
                )
            }
        }

        static func update(
            status: RecentDrivesLoadStatus = .loaded,
            connection: RecentDrivesConnection = .live,
            count: Int = 4
        ) -> RecentDrivesUpdate {
            RecentDrivesUpdate(
                status: status,
                items: status == .loading ? [] : items(count: count),
                formatting: RecentDrivesFormatting(distanceUnit: "mi", precision: 1),
                connection: connection
            )
        }
    }

    @MainActor
    private func recentDrivesPreview(_ update: RecentDrivesUpdate) -> RecentDrivesSection {
        let model = RecentDrivesModel(
            source: InMemoryRecentDrivesSource(initial: update),
            telemetry: SilentRecentDrivesTelemetry()
        )
        return RecentDrivesSection(model: model)
    }

    #Preview("Content") {
        ScrollView { recentDrivesPreview(RecentDrivesPreviewData.update()).padding() }
    }

    #Preview("Content · paginated") {
        ScrollView { recentDrivesPreview(RecentDrivesPreviewData.update(count: 58)).padding() }
    }

    #Preview("Empty") {
        recentDrivesPreview(RecentDrivesPreviewData.update(count: 0)).padding()
    }

    #Preview("Loading") {
        recentDrivesPreview(RecentDrivesPreviewData.update(status: .loading)).padding()
    }

    #Preview("Error") {
        recentDrivesPreview(RecentDrivesPreviewData.update(status: .failed("Request timed out"), count: 0))
            .padding()
    }

    #Preview("Stale") {
        ScrollView { recentDrivesPreview(RecentDrivesPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { recentDrivesPreview(RecentDrivesPreviewData.update(connection: .offline)).padding() }
    }
#endif
