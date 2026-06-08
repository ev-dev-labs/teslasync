//
//  SummaryStatsRow.Previews.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  Xcode previews for each surface state (loading / secure / unsecure / missing
//  last-lock). A fixed `clock` makes the relative-time wording deterministic.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private let previewNow = ISO8601DateFormatter().date(from: "2026-01-05T15:04:05Z") ?? Date()

    @MainActor
    private func previewModel(_ input: SummaryStatsInput) -> SummaryStatsModel {
        let source = InMemorySummaryStatsSource(initial: input)
        let model = SummaryStatsModel(
            source: source,
            locale: Locale(identifier: "en_US"),
            clock: { previewNow }
        )
        model.start()
        return model
    }

    #Preview("Loading") {
        SummaryStatsRow(model: previewModel(SummaryStatsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Secure") {
        SummaryStatsRow(model: previewModel(SummaryStatsInput(
            isSecure: true,
            lastLockChange: "2026-01-05T13:30:00Z",
            sentryUptime: 99,
            totalEvents: 1284
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Unsecure") {
        SummaryStatsRow(model: previewModel(SummaryStatsInput(
            isSecure: false,
            lastLockChange: "2026-01-05T15:02:30Z",
            sentryUptime: 87,
            totalEvents: 42
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Missing last lock") {
        SummaryStatsRow(model: previewModel(SummaryStatsInput(
            isSecure: true,
            lastLockChange: nil,
            sentryUptime: 100,
            totalEvents: 0
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
