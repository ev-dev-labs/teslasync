//
//  FreshnessIndicator.Previews.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  Xcode previews for each surface state (loading / unavailable / fresh / stale / offline / empty)
//  plus the size + label-visibility variants. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum FreshnessPreviewClock {
        /// An ISO-8601 timestamp `seconds` in the past, relative to now — so each preview lands in the
        /// intended status band against the model's default system clock.
        static func iso(secondsAgo seconds: TimeInterval) -> String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: Date().addingTimeInterval(-seconds))
        }
    }

    @MainActor
    private func previewModel(
        _ input: FreshnessInput,
        config: FreshnessConfig = .default
    ) -> FreshnessIndicatorModel {
        let source = InMemoryFreshnessIndicatorSource(initial: input)
        let model = FreshnessIndicatorModel(source: source, config: config)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: FreshnessIndicatorModel) -> some View {
        FreshnessIndicator(model: model)
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(FreshnessInput(status: .loading)))
    }

    #Preview("Unavailable") {
        staged(previewModel(FreshnessInput(status: .failed)))
    }

    #Preview("Fresh") {
        staged(previewModel(FreshnessInput(
            status: .resolved,
            timestamp: FreshnessPreviewClock.iso(secondsAgo: 5)
        )))
    }

    #Preview("Stale") {
        staged(previewModel(FreshnessInput(
            status: .resolved,
            timestamp: FreshnessPreviewClock.iso(secondsAgo: 200)
        )))
    }

    #Preview("Offline") {
        staged(previewModel(FreshnessInput(
            status: .resolved,
            timestamp: FreshnessPreviewClock.iso(secondsAgo: 1200)
        )))
    }

    #Preview("Empty (unknown)") {
        staged(previewModel(FreshnessInput(status: .resolved, timestamp: nil)))
    }

    #Preview("Medium, label hidden") {
        staged(previewModel(
            FreshnessInput(status: .resolved, timestamp: FreshnessPreviewClock.iso(secondsAgo: 35)),
            config: FreshnessConfig(showLabel: false, size: .medium)
        ))
    }
#endif
