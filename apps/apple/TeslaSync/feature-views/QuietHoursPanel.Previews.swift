//
//  QuietHoursPanel.Previews.swift
//  TeslaSync — P4 feature view · 0210 · QuietHoursPanel (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated list of
//  windows), empty (resolved with no rows), loading (initial spinner), error (fetch
//  failed → retry), the create + edit forms (a draft open), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentQuietHoursTelemetry: QuietHoursTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample windows spanning enabled/disabled, wrap/non-wrap times, and bypass lists.
    private enum QuietHoursPreviewData {
        static let weekdaysWorkweek = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)

        static func items() -> [QuietHoursWindowItem] {
            [
                QuietHoursWindowItem(
                    id: 1,
                    enabled: true,
                    startLocal: "23:00",
                    endLocal: "07:00",
                    timezone: "Europe/London",
                    weekdays: QuietHoursWeekdays.all,
                    bypassSeverities: ["critical"]
                ),
                QuietHoursWindowItem(
                    id: 2,
                    enabled: false,
                    startLocal: "09:00",
                    endLocal: "17:00",
                    timezone: "America/New_York",
                    weekdays: weekdaysWorkweek,
                    bypassSeverities: ["critical", "warn"]
                )
            ]
        }

        static func update(
            status: QuietHoursLoadStatus = .loaded,
            connection: QuietHoursConnection = .live,
            empty: Bool = false
        ) -> QuietHoursUpdate {
            QuietHoursUpdate(
                status: status,
                items: empty ? [] : items(),
                connection: connection
            )
        }
    }

    @MainActor
    private func quietHoursPreview(
        _ update: QuietHoursUpdate,
        prepare: (QuietHoursModel) -> Void = { _ in }
    ) -> QuietHoursPanel {
        let model = QuietHoursModel(
            source: InMemoryQuietHoursSource(initial: update),
            telemetry: SilentQuietHoursTelemetry()
        )
        prepare(model)
        return QuietHoursPanel(model: model)
    }

    #Preview("Content") {
        ScrollView { quietHoursPreview(QuietHoursPreviewData.update()).padding() }
    }

    #Preview("Empty") {
        quietHoursPreview(QuietHoursPreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        quietHoursPreview(QuietHoursPreviewData.update(status: .loading, empty: true)).padding()
    }

    #Preview("Error") {
        quietHoursPreview(QuietHoursPreviewData.update(status: .failed("Request timed out"), empty: true))
            .padding()
    }

    #Preview("Create form") {
        ScrollView {
            quietHoursPreview(QuietHoursPreviewData.update(empty: true)) { model in
                model.startCreate()
            }
            .padding()
        }
    }

    #Preview("Edit form") {
        ScrollView {
            quietHoursPreview(QuietHoursPreviewData.update()) { model in
                model.startEdit(QuietHoursPreviewData.items()[0])
            }
            .padding()
        }
    }

    #Preview("Stale") {
        ScrollView { quietHoursPreview(QuietHoursPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { quietHoursPreview(QuietHoursPreviewData.update(connection: .offline)).padding() }
    }
#endif
