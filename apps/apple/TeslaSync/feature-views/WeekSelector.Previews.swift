//
//  WeekSelector.Previews.swift
//  TeslaSync — P4 feature view · 0079 · WeekSelector (Apple)
//
//  Xcode previews for each surface state (content on the current week, content on
//  a past week with Next enabled, loading, empty, error, stale, offline) so the
//  always-present bar + the layered digest chrome are exercised. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: WeekSelectorUpdate,
        offset: Int = 0
    ) -> WeekSelectorModel {
        let source = InMemoryWeekSelectorSource(initial: update)
        let model = WeekSelectorModel(source: source, initialOffset: offset)
        model.start()
        return model
    }

    #Preview("Content (current week)") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(status: .loaded, connection: .live, hasData: true, updatedAt: Date())
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (past week, Next enabled)") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(status: .loaded, connection: .live, hasData: true, updatedAt: Date()),
                offset: -2
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        WeekSelector(
            model: previewModel(WeekSelectorUpdate(status: .loading, hasData: false))
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no activity)") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(status: .loaded, connection: .live, hasData: false, updatedAt: Date()),
                offset: -1
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(status: .failed("The drives endpoint timed out"), hasData: false),
                offset: -1
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(
                    status: .loaded,
                    connection: .stale,
                    hasData: true,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        WeekSelector(
            model: previewModel(
                WeekSelectorUpdate(
                    status: .loaded,
                    connection: .offline,
                    hasData: true,
                    updatedAt: Date().addingTimeInterval(-900)
                ),
                offset: -1
            )
        )
        .frame(width: 520)
        .padding()
        .background(Color.TS.bg)
    }
#endif
