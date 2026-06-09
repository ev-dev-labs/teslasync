//
//  AlertDetailTimeline.Previews.swift
//  TeslaSync — P4 feature view · 0001 · AlertDetailTimeline (Apple)
//
//  Xcode previews for each surface state (content / empty / loading / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: AlertDetailTimelineUpdate) -> AlertDetailTimelineModel {
        let source = InMemoryAlertDetailTimelineSource(initial: update)
        let model = AlertDetailTimelineModel(source: source)
        model.start()
        return model
    }

    /// A representative audit trail exercising every kind/tint: the synthetic anonymous
    /// `created` (with a note), an actor'd `acknowledged`, an actor'd `commented` (with a
    /// note), and an anonymous `reopened`.
    private func previewEvents() -> [AlertDetailTimelineEvent] {
        let base = Date(timeIntervalSince1970: 1_736_000_000)
        return [
            AlertDetailTimelineEvent(
                id: 1,
                occurredAt: base,
                actor: nil,
                kind: .created,
                note: "BatteryLevel < 20% on vehicle Lightning"
            ),
            AlertDetailTimelineEvent(
                id: 2,
                occurredAt: base.addingTimeInterval(900),
                actor: "Alex Rivera",
                kind: .acknowledged,
                note: nil
            ),
            AlertDetailTimelineEvent(
                id: 3,
                occurredAt: base.addingTimeInterval(1800),
                actor: "Alex Rivera",
                kind: .commented,
                note: "Scheduled an overnight charge — keeping an eye on it."
            ),
            AlertDetailTimelineEvent(
                id: 4,
                occurredAt: base.addingTimeInterval(3600),
                actor: nil,
                kind: .reopened,
                note: nil
            )
        ]
    }

    #Preview("Content") {
        AlertDetailTimeline(model: previewModel(
            AlertDetailTimelineUpdate(status: .loaded, events: previewEvents())
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        AlertDetailTimeline(model: previewModel(AlertDetailTimelineUpdate(status: .empty)))
            .frame(maxWidth: 520)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AlertDetailTimeline(model: previewModel(AlertDetailTimelineUpdate(status: .loading)))
            .frame(maxWidth: 520)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AlertDetailTimeline(model: previewModel(
            AlertDetailTimelineUpdate(status: .failed("The request timed out"))
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AlertDetailTimeline(model: previewModel(
            AlertDetailTimelineUpdate(status: .loaded, events: previewEvents(), connection: .stale)
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AlertDetailTimeline(model: previewModel(
            AlertDetailTimelineUpdate(status: .loaded, events: previewEvents(), connection: .offline)
        ))
        .frame(maxWidth: 520)
        .padding()
        .background(Color.TS.bg)
    }
#endif
