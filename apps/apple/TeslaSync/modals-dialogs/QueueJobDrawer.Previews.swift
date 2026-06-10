//
//  QueueJobDrawer.Previews.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  Xcode previews — one per state the surface produces: the populated list (with + without a
//  worker name), a list carrying a failed-job error row, loading, empty, error, and the stale /
//  offline freshness variants. The clock is fixed so the rendered "Started …" copy is
//  deterministic. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentQueueJobDrawerTelemetry: QueueJobDrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A fixed date facade so preview captions never drift with the wall clock or locale.
    private struct FixedQueueJobDateFormatting: QueueJobDateFormatting {
        func dateTime(_: Date) -> String {
            "Apr 4, 2026 at 2:30 AM"
        }
    }

    /// Sample jobs spanning the status-tone buckets, anchored to a fixed clock.
    private enum QueueJobDrawerPreviewData {
        static let anchor = Date(timeIntervalSince1970: 1_717_000_000)

        static func jobs() -> [QueueJobRowData] {
            [
                QueueJobRowData(
                    id: "1", worker: "notification", status: "sent",
                    title: "Charge complete · Model Y",
                    startedAt: anchor.addingTimeInterval(-600), finishedAt: anchor.addingTimeInterval(-598),
                    durationMs: 1850
                ),
                QueueJobRowData(
                    id: "2", worker: "notification", status: "processing",
                    title: "Geofence arrival · Home",
                    startedAt: anchor.addingTimeInterval(-120)
                ),
                QueueJobRowData(
                    id: "3", worker: "notification", status: "pending",
                    title: "Weekly summary digest",
                    startedAt: anchor.addingTimeInterval(-90)
                )
            ]
        }

        static func withError() -> [QueueJobRowData] {
            jobs() + [
                QueueJobRowData(
                    id: "4", worker: "notification", status: "failed",
                    title: "Push to device A1B2",
                    startedAt: anchor.addingTimeInterval(-7200), finishedAt: anchor.addingTimeInterval(-7140),
                    durationMs: 60000, error: "APNs returned 410 BadDeviceToken — token unregistered"
                )
            ]
        }

        static func update(
            status: QueueJobLoadStatus = .loaded,
            connection: QueueJobDrawerConnection = .live,
            jobs: [QueueJobRowData] = jobs()
        ) -> QueueJobsUpdate {
            QueueJobsUpdate(status: status, jobs: jobs, connection: connection)
        }
    }

    @MainActor
    private func queueJobDrawerModel(
        update: QueueJobsUpdate,
        displayName: String? = "Notification"
    ) -> QueueJobDrawerModel {
        QueueJobDrawerModel(
            source: InMemoryQueueJobsSource(initial: update),
            worker: "notification",
            displayName: displayName,
            telemetry: SilentQueueJobDrawerTelemetry(),
            dates: FixedQueueJobDateFormatting()
        )
    }

    @MainActor
    private func queueJobDrawerPreview(
        update: QueueJobsUpdate,
        displayName: String? = "Notification"
    ) -> some View {
        QueueJobDrawer(model: queueJobDrawerModel(update: update, displayName: displayName))
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            .background(Color.TS.bg)
    }

    #Preview("List · worker") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update())
    }

    #Preview("List · no worker name") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update(), displayName: nil)
    }

    #Preview("List · with error row") {
        queueJobDrawerPreview(
            update: QueueJobDrawerPreviewData.update(jobs: QueueJobDrawerPreviewData.withError())
        )
    }

    #Preview("Loading") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update(status: .loading, jobs: []))
    }

    #Preview("Empty") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update(jobs: []))
    }

    #Preview("Error") {
        queueJobDrawerPreview(
            update: QueueJobDrawerPreviewData.update(status: .failed("Request timed out"), jobs: [])
        )
    }

    #Preview("Stale") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        queueJobDrawerPreview(update: QueueJobDrawerPreviewData.update(connection: .offline))
    }
#endif
