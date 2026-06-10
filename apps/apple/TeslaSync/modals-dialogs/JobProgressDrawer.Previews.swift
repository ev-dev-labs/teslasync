//
//  JobProgressDrawer.Previews.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  Xcode previews — one per state the surface produces: the minimized chip (active + idle),
//  the open panel (both buckets), active-only, recent-only, loading, empty, error, and the
//  stale / offline freshness variants. The open / empty / loading / error previews use a
//  `pinned` model so the ambient auto-hide doesn't collapse the chrome. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentJobProgressDrawerTelemetry: JobProgressDrawerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample jobs spanning the active (processing / queued) and recent (ready / failed /
    /// expired) buckets, anchored to a fixed clock so the relative times are deterministic.
    private enum JobProgressDrawerPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static func active() -> [ExportDrawerJob] {
            [
                ExportDrawerJob(
                    id: "1", kind: .drives, format: "csv", status: .processing,
                    createdAt: now.addingTimeInterval(-90)
                ),
                ExportDrawerJob(
                    id: "2", kind: .charging, format: "json", status: .queued,
                    createdAt: now.addingTimeInterval(-30)
                )
            ]
        }

        static func recent() -> [ExportDrawerJob] {
            [
                ExportDrawerJob(
                    id: "3", kind: .analytics, format: "csv", status: .ready,
                    fileSize: 5_242_880, createdAt: now.addingTimeInterval(-3600),
                    completedAt: now.addingTimeInterval(-3000)
                ),
                ExportDrawerJob(
                    id: "4", kind: .backup, format: "json", status: .failed,
                    errorMessage: "Upstream timeout", createdAt: now.addingTimeInterval(-7200),
                    completedAt: now.addingTimeInterval(-7000)
                ),
                ExportDrawerJob(
                    id: "5", kind: .account, format: "zip", status: .expired,
                    createdAt: now.addingTimeInterval(-200_000),
                    completedAt: now.addingTimeInterval(-190_000)
                )
            ]
        }

        static func update(
            status: ExportDrawerLoadStatus = .loaded,
            connection: ExportDrawerConnection = .live,
            jobs: [ExportDrawerJob] = active() + recent()
        ) -> ExportDrawerJobsUpdate {
            ExportDrawerJobsUpdate(status: status, jobs: jobs, connection: connection)
        }
    }

    @MainActor
    private func jobDrawerModel(
        update: ExportDrawerJobsUpdate,
        presentation: JobDrawerPresentation,
        pinned: Bool = false
    ) -> JobProgressDrawerModel {
        JobProgressDrawerModel(
            source: InMemoryExportDrawerJobsSource(initial: update),
            pinned: pinned,
            telemetry: SilentJobProgressDrawerTelemetry(),
            store: InMemoryJobDrawerPresentationStore(initial: presentation),
            now: { JobProgressDrawerPreviewData.now }
        )
    }

    @MainActor
    private func jobDrawerPreview(
        update: ExportDrawerJobsUpdate,
        presentation: JobDrawerPresentation,
        pinned: Bool = false
    ) -> some View {
        JobProgressDrawer(model: jobDrawerModel(update: update, presentation: presentation, pinned: pinned))
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .background(Color.TS.bg)
    }

    #Preview("Minimized · active") {
        jobDrawerPreview(update: JobProgressDrawerPreviewData.update(), presentation: .minimized)
    }

    #Preview("Minimized · idle") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(jobs: JobProgressDrawerPreviewData.recent()),
            presentation: .minimized
        )
    }

    #Preview("Open · content") {
        jobDrawerPreview(update: JobProgressDrawerPreviewData.update(), presentation: .open)
    }

    #Preview("Open · active only") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(jobs: JobProgressDrawerPreviewData.active()),
            presentation: .open
        )
    }

    #Preview("Open · recent only") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(jobs: JobProgressDrawerPreviewData.recent()),
            presentation: .open
        )
    }

    #Preview("Loading") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(status: .loading, jobs: []),
            presentation: .open,
            pinned: true
        )
    }

    #Preview("Empty") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(jobs: []),
            presentation: .open,
            pinned: true
        )
    }

    #Preview("Error") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(status: .failed("Request timed out"), jobs: []),
            presentation: .open,
            pinned: true
        )
    }

    #Preview("Stale") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(connection: .stale),
            presentation: .open
        )
    }

    #Preview("Offline") {
        jobDrawerPreview(
            update: JobProgressDrawerPreviewData.update(connection: .offline),
            presentation: .open
        )
    }
#endif
