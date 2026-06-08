//
//  FSMTimelineChart.Previews.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated
//  multi-FSM transition log over the last six hours), empty (resolved, no transitions
//  → web "No transition data for timeline" overlay), loading (initial skeleton
//  chrome), error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFSMTimelineChartTelemetry: FSMTimelineChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A representative multi-FSM transition log spread across the last six hours, so
    /// the populated previews show a busy, multi-series stack.
    private enum FSMTimelinePreviewData {
        static let windowHours = 6

        /// Builds transitions at `now − minutesAgo`, cycling the FSM names + minute
        /// offsets so several stacked bands appear across the window.
        static func transitions(now: Date = Date()) -> [FSMTransitionInput] {
            let names = ["vehicle", "telemetry_connection", "drive", "charge"]
            let minutesAgo: [Int] = [
                12, 18, 22, 35, 41, 55, 67, 73, 88, 96,
                110, 124, 133, 150, 168, 181, 199, 210, 233, 250,
                271, 288, 301, 322, 339
            ]
            return minutesAgo.enumerated().map { offset, minute in
                FSMTransitionInput(
                    timestamp: now.addingTimeInterval(TimeInterval(-minute * 60)),
                    fsmName: names[offset % names.count]
                )
            }
        }
    }

    @MainActor
    private func fsmTimelinePreview(_ update: FSMTimelineChartUpdate) -> FSMTimelineChart {
        FSMTimelineChart(
            model: FSMTimelineChartModel(
                source: InMemoryFSMTimelineChartSource(initial: update),
                telemetry: SilentFSMTimelineChartTelemetry()
            )
        )
    }

    private func fsmTimelineUpdate(
        status: FSMTimelineLoadStatus,
        populated: Bool,
        connection: FSMTimelineConnection
    ) -> FSMTimelineChartUpdate {
        FSMTimelineChartUpdate(
            status: status,
            transitions: populated ? FSMTimelinePreviewData.transitions() : [],
            hours: FSMTimelinePreviewData.windowHours,
            connection: connection
        )
    }

    #Preview("Content") {
        fsmTimelinePreview(fsmTimelineUpdate(status: .loaded, populated: true, connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        fsmTimelinePreview(fsmTimelineUpdate(status: .loaded, populated: false, connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        fsmTimelinePreview(fsmTimelineUpdate(status: .loading, populated: false, connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Error") {
        fsmTimelinePreview(
            FSMTimelineChartUpdate(status: .failed("Request timed out"), hours: 6, connection: .live)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        fsmTimelinePreview(fsmTimelineUpdate(status: .loaded, populated: true, connection: .stale))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        fsmTimelinePreview(fsmTimelineUpdate(status: .loaded, populated: true, connection: .offline))
            .padding()
            .frame(maxWidth: 520)
    }
#endif
