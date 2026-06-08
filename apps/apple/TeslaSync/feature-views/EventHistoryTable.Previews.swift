//
//  EventHistoryTable.Previews.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  Xcode previews for each surface state (loading / data / empty / error). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: EventHistoryInput) -> EventHistoryModel {
        let source = InMemoryEventHistorySource(initial: input)
        let model = EventHistoryModel(source: source)
        model.start()
        return model
    }

    private let previewEvents: [SecurityEventInput] = [
        SecurityEventInput(
            id: "1",
            createdAt: "2026-01-05T15:04:05Z",
            locked: .bool(true),
            sentryMode: .string("Armed"),
            doorState: .string("Closed"),
            fdWindow: .string("Closed"),
            fpWindow: .string("Closed"),
            rdWindow: .string("Closed"),
            rpWindow: .string("Closed")
        ),
        SecurityEventInput(
            id: "2",
            createdAt: "2026-01-05T09:30:00Z",
            locked: .bool(false),
            sentryMode: .bool(false),
            doorState: .string("DriverFrontOpen"),
            fdWindow: .string("Open"),
            fpWindow: .string("Vent"),
            rdWindow: .string("Closed"),
            rpWindow: .string("Closed")
        ),
        SecurityEventInput(
            id: "3",
            createdAt: "2026-01-04T22:10:00Z",
            locked: .bool(true),
            sentryMode: .string("off"),
            doorState: .null,
            fdWindow: .string("Closed"),
            fpWindow: .string("Closed"),
            rdWindow: .string("Closed"),
            rpWindow: .string("Closed")
        )
    ]

    #Preview("Loading") {
        EventHistoryTable(model: previewModel(EventHistoryInput(isLoading: true)))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        EventHistoryTable(model: previewModel(EventHistoryInput(events: previewEvents)))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        EventHistoryTable(model: previewModel(EventHistoryInput(events: [])))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EventHistoryTable(model: previewModel(
            EventHistoryInput(errorMessage: "Tesla API returned 503 Service Unavailable")
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }
#endif
