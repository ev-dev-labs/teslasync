//
//  ScheduledExportsPanel.Previews.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated list with an
//  enabled + a disabled/failed schedule), the inline create form, empty (resolved with no
//  rows), loading (three skeleton bars), error (fetch failed → retry), and the stale /
//  offline freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentScheduledExportsTelemetry: ScheduledExportsTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample schedules spanning download / email delivery, enabled / disabled, and the
    /// ok / failed / never-run status arms.
    private enum ScheduledExportsPreviewData {
        static func items() -> [ScheduledExportItem] {
            let now = Date(timeIntervalSince1970: 1_717_000_000)
            return [
                ScheduledExportItem(
                    id: 1,
                    name: "Drives weekly",
                    exportType: .drives,
                    format: .csv,
                    scheduleCron: "0 9 * * 0",
                    delivery: ScheduledExportDelivery(kind: .download),
                    rangeWindow: "7d",
                    enabled: true,
                    lastRunAt: now.addingTimeInterval(-7 * 86400),
                    lastStatus: .ok,
                    nextRunAt: now.addingTimeInterval(86400)
                ),
                ScheduledExportItem(
                    id: 2,
                    name: "Charging → ops webhook",
                    exportType: .charging,
                    format: .json,
                    scheduleCron: "0 0 * * *",
                    delivery: ScheduledExportDelivery(kind: .webhook, target: "https://ops.example.com/hook"),
                    rangeWindow: "24h",
                    enabled: false,
                    lastRunAt: now.addingTimeInterval(-2 * 86400),
                    lastStatus: .failed,
                    nextRunAt: nil
                )
            ]
        }

        static func update(
            status: ScheduledExportsLoadStatus = .loaded,
            connection: ScheduledExportsConnection = .live,
            empty: Bool = false
        ) -> ScheduledExportsUpdate {
            ScheduledExportsUpdate(
                status: status,
                items: empty ? [] : items(),
                connection: connection
            )
        }
    }

    @MainActor
    private func scheduledExportsModel(_ update: ScheduledExportsUpdate) -> ScheduledExportsModel {
        ScheduledExportsModel(
            source: InMemoryScheduledExportsSource(initial: update),
            telemetry: SilentScheduledExportsTelemetry()
        )
    }

    @MainActor
    private func scheduledExportsPreview(_ update: ScheduledExportsUpdate) -> ScheduledExportsPanel {
        ScheduledExportsPanel(model: scheduledExportsModel(update))
    }

    #Preview("Content") {
        ScrollView { scheduledExportsPreview(ScheduledExportsPreviewData.update()).padding() }
    }

    #Preview("Create form") {
        let model = scheduledExportsModel(ScheduledExportsPreviewData.update())
        model.startCreate()
        return ScrollView { ScheduledExportsPanel(model: model).padding() }
    }

    #Preview("Empty") {
        scheduledExportsPreview(ScheduledExportsPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        scheduledExportsPreview(ScheduledExportsPreviewData.update(status: .loading, empty: true)).padding()
    }

    #Preview("Error") {
        scheduledExportsPreview(
            ScheduledExportsPreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView { scheduledExportsPreview(ScheduledExportsPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { scheduledExportsPreview(ScheduledExportsPreviewData.update(connection: .offline)).padding() }
    }
#endif
