//
//  DataFreshness.Previews.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  Xcode previews for each freshness state (fresh / fetching-loading / refetching / stale / error /
//  offline / empty) plus the compact + read-only variants. DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DataFreshnessPreviewClock {
        /// A `Date` `seconds` in the past, relative to now — so each preview lands in the intended
        /// relative-time band against the model's default system clock.
        static func ago(_ seconds: TimeInterval) -> Date {
            Date().addingTimeInterval(-seconds)
        }
    }

    @MainActor
    private func previewModel(
        _ input: DataFreshnessInput,
        config: DataFreshnessConfig = .default
    ) -> DataFreshnessModel {
        let source = InMemoryDataFreshnessSource(initial: input)
        let model = DataFreshnessModel(source: source, config: config)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: DataFreshnessModel) -> some View {
        DataFreshness(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Fresh") {
        staged(previewModel(DataFreshnessInput(updatedAt: DataFreshnessPreviewClock.ago(180))))
    }

    #Preview("Fetching (initial load)") {
        staged(previewModel(DataFreshnessInput(isFetching: true)))
    }

    #Preview("Refetching (background)") {
        staged(previewModel(DataFreshnessInput(
            updatedAt: DataFreshnessPreviewClock.ago(120),
            isFetching: true
        )))
    }

    #Preview("Stale") {
        staged(previewModel(DataFreshnessInput(
            updatedAt: DataFreshnessPreviewClock.ago(7200),
            isStale: true
        )))
    }

    #Preview("Error (first load)") {
        staged(previewModel(DataFreshnessInput(isError: true)))
    }

    #Preview("Offline (errored, cached)") {
        staged(previewModel(DataFreshnessInput(
            updatedAt: DataFreshnessPreviewClock.ago(300),
            isError: true
        )))
    }

    #Preview("Empty (never updated)") {
        staged(previewModel(DataFreshnessInput()))
    }

    #Preview("Compact, read-only") {
        staged(previewModel(
            DataFreshnessInput(updatedAt: DataFreshnessPreviewClock.ago(45)),
            config: DataFreshnessConfig(compact: true, refreshable: false)
        ))
    }
#endif
