//
//  EventTimeline.Previews.swift
//  TeslaSync — P4 feature view · 0043 · EventTimeline (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: EventTimelineUpdate) -> EventTimelineModel {
        let source = InMemoryEventTimelineSource(initial: update)
        let model = EventTimelineModel(source: source)
        model.start()
        return model
    }

    /// A short security history whose consecutive diffs yield lock + sentry + door rows
    /// across both polarities — enough to exercise every icon/tint in the content preview.
    private func previewHistory() -> [EventTimelineSecurityEvent] {
        let base = Date(timeIntervalSince1970: 1_736_000_000)
        return [
            EventTimelineSecurityEvent(
                id: "4",
                createdAt: base,
                locked: true,
                sentryMode: .string("on"),
                doorState: .string("Closed")
            ),
            EventTimelineSecurityEvent(
                id: "3",
                createdAt: base.addingTimeInterval(-600),
                locked: false,
                sentryMode: .string("on"),
                doorState: .string("Open")
            ),
            EventTimelineSecurityEvent(
                id: "2",
                createdAt: base.addingTimeInterval(-1800),
                locked: false,
                sentryMode: .string("off"),
                doorState: .string("Open")
            ),
            EventTimelineSecurityEvent(
                id: "1",
                createdAt: base.addingTimeInterval(-3600),
                locked: true,
                sentryMode: .string("off"),
                doorState: .string("Closed")
            )
        ]
    }

    #Preview("Content") {
        EventTimeline(model: previewModel(
            EventTimelineUpdate(status: .loaded, events: previewHistory())
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EventTimeline(model: previewModel(EventTimelineUpdate(status: .empty)))
            .frame(maxWidth: 520)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EventTimeline(model: previewModel(EventTimelineUpdate(status: .loading)))
            .frame(maxWidth: 520)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EventTimeline(model: previewModel(
            EventTimelineUpdate(status: .failed("The request timed out"))
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        EventTimeline(model: previewModel(
            EventTimelineUpdate(status: .loaded, events: previewHistory(), connection: .stale)
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        EventTimeline(model: previewModel(
            EventTimelineUpdate(status: .loaded, events: previewHistory(), connection: .offline)
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }
#endif
