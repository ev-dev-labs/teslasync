//
//  StateTimeline.Previews.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated rail with
//  a selected tick), empty (resolved, no transitions → web "No transitions in window"),
//  empty-with-hint (the actionable widen-window / jump-to-last branch), loading (the
//  initial skeleton rail), error (fetch failed → retry), and the stale / offline
//  freshness variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentStateTimelineTelemetry: StateTimelineTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A representative vehicle-FSM transition log spread across the last half hour, so
    /// the populated previews show a busy, multi-state rail.
    private enum StateTimelinePreviewData {
        static let windowMinutes = 30

        static func transitions(now: Date = Date()) -> [StateTransitionInput] {
            let states = ["asleep", "online", "driving", "charging", "online", "offline"]
            let minutesAgo: [Int] = [28, 24, 19, 14, 9, 3]
            return zip(minutesAgo, states.indices).map { minute, index in
                StateTransitionInput(
                    id: index + 1,
                    timestamp: now.addingTimeInterval(TimeInterval(-minute * 60)),
                    fromState: index == 0 ? "asleep" : states[index - 1],
                    toState: states[index]
                )
            }
        }
    }

    @MainActor
    private func stateTimelinePreview(_ update: StateTimelineUpdate) -> StateTimeline {
        StateTimeline(
            model: StateTimelineModel(
                source: InMemoryStateTimelineSource(initial: update),
                telemetry: SilentStateTimelineTelemetry()
            )
        )
    }

    private func populatedUpdate(connection: StateTimelineConnection) -> StateTimelineUpdate {
        StateTimelineUpdate(
            status: .loaded,
            transitions: StateTimelinePreviewData.transitions(),
            fsmType: "vehicle",
            windowMinutes: StateTimelinePreviewData.windowMinutes,
            selectedID: 4,
            connection: connection
        )
    }

    #Preview("Content") {
        stateTimelinePreview(populatedUpdate(connection: .live))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Empty") {
        stateTimelinePreview(
            StateTimelineUpdate(
                status: .loaded,
                transitions: [],
                fsmType: "vehicle",
                windowMinutes: StateTimelinePreviewData.windowMinutes
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Empty · actionable hint") {
        stateTimelinePreview(
            StateTimelineUpdate(
                status: .loaded,
                transitions: [],
                fsmType: "vehicle",
                windowMinutes: StateTimelinePreviewData.windowMinutes,
                lastTransition: StateTransitionInput(
                    id: 99,
                    timestamp: Date().addingTimeInterval(-3 * 3600),
                    fromState: "online",
                    toState: "asleep"
                ),
                widerPreset: 360
            )
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Loading") {
        stateTimelinePreview(
            StateTimelineUpdate(status: .loading, fsmType: "vehicle", windowMinutes: 30)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Error") {
        stateTimelinePreview(
            StateTimelineUpdate(status: .failed("Request timed out"), fsmType: "vehicle", windowMinutes: 30)
        )
        .padding()
        .frame(maxWidth: 520)
    }

    #Preview("Stale") {
        stateTimelinePreview(populatedUpdate(connection: .stale))
            .padding()
            .frame(maxWidth: 520)
    }

    #Preview("Offline") {
        stateTimelinePreview(populatedUpdate(connection: .offline))
            .padding()
            .frame(maxWidth: 520)
    }
#endif
