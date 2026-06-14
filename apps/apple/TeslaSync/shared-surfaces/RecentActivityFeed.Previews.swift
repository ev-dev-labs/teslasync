//
//  RecentActivityFeed.Previews.swift
//  TeslaSync — P4 shared surface · 0100 · RecentActivityFeed (Apple)
//
//  Xcode previews for each surface state (the populated timeline with + without click-through, the
//  custom + default empty states, plus loading / error / stale / offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum RecentActivityFeedPreviewData {
        static func entries(now: Date = Date()) -> [RecentActivityFeedEntry] {
            [
                RecentActivityFeedEntry(
                    id: 1,
                    timestamp: now.addingTimeInterval(-30),
                    action: "vehicle.command.wake",
                    entityType: "vehicle",
                    entityID: "12",
                    detail: "Model 3 woke from sleep"
                ),
                RecentActivityFeedEntry(
                    id: 2,
                    timestamp: now.addingTimeInterval(-8 * 60),
                    action: "charge.start",
                    entityType: "charging_session",
                    entityID: "8842",
                    detail: "Home wall connector"
                ),
                RecentActivityFeedEntry(
                    id: 3,
                    timestamp: now.addingTimeInterval(-3 * 3600),
                    action: "alert.rule.create",
                    entityType: "alert_rule",
                    entityID: "5",
                    detail: nil
                ),
                RecentActivityFeedEntry(
                    id: 4,
                    timestamp: now.addingTimeInterval(-2 * 86400),
                    action: "settings.update",
                    entityType: nil,
                    entityID: nil,
                    detail: "Changed distance units to km"
                ),
                RecentActivityFeedEntry(
                    id: 5,
                    timestamp: now.addingTimeInterval(-9 * 86400),
                    action: "auth.login",
                    entityType: nil,
                    entityID: nil,
                    detail: nil
                )
            ]
        }
    }

    /// Builds an optional click-through handler, sidestepping the `cond ? {} : nil` inference limitation
    /// for `@MainActor` closures by returning the closure from an explicitly-typed function.
    @MainActor
    private func previewNavigate(_ enabled: Bool) -> (@MainActor (String) -> Void)? {
        guard enabled else { return nil }
        return { _ in }
    }

    @MainActor
    private func previewModel(
        _ input: RecentActivityFeedInput,
        navigate: Bool = true
    ) -> RecentActivityFeedModel {
        let source = InMemoryRecentActivityFeedSource(initial: input)
        let model = RecentActivityFeedModel(source: source, onNavigate: previewNavigate(navigate))
        model.start()
        return model
    }

    #Preview("Content — links") {
        RecentActivityFeed(model: previewModel(
            RecentActivityFeedInput(entries: RecentActivityFeedPreviewData.entries())
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — no router") {
        RecentActivityFeed(model: previewModel(
            RecentActivityFeedInput(entries: RecentActivityFeedPreviewData.entries()),
            navigate: false
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — default") {
        RecentActivityFeed(model: previewModel(RecentActivityFeedInput()))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty — custom message") {
        RecentActivityFeed(model: previewModel(
            RecentActivityFeedInput(emptyMessage: "No commands sent in the last 24 hours.")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        RecentActivityFeed(model: previewModel(RecentActivityFeedInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        RecentActivityFeed(model: previewModel(
            RecentActivityFeedInput(errorMessage: "The activity request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        RecentActivityFeed(model: previewModel(RecentActivityFeedInput(
            entries: RecentActivityFeedPreviewData.entries(),
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        RecentActivityFeed(model: previewModel(RecentActivityFeedInput(
            entries: RecentActivityFeedPreviewData.entries(),
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
