//
//  SecurityStatistics.Previews.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  Xcode previews for each surface state (loading / loaded / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-
//  surface release typecheck scope.
//

#if DEBUG
    import Foundation
    import SwiftUI

    private let previewSnapshot = SecurityStatsSnapshot(
        stats: SecurityStatsValue(
            lockEvents: 42,
            doorOpenCount: 17,
            windowOpenCount: 6,
            homelinkCount: 23,
            guestCount: 3,
            total: 128
        ),
        sentryUptimePercent: 87
    )

    /// A clock that returns a base time on its first read (the load's `lastUpdatedAt`)
    /// and an advanced time afterwards, so the freshness-window preview renders the
    /// stale state deterministically.
    private final class SecurityStatisticsPreviewClock: @unchecked Sendable {
        private let base = Date()
        private let advance: TimeInterval
        private var reads = 0

        init(advance: TimeInterval) {
            self.advance = advance
        }

        func now() -> Date {
            defer { reads += 1 }
            return reads == 0 ? base : base.addingTimeInterval(advance)
        }
    }

    @MainActor
    private func previewModel(
        outcome: SecurityStatisticsOutcome? = nil,
        autoResponds: Bool = true,
        thenPush: [SecurityStatisticsOutcome] = [],
        now: @escaping @Sendable () -> Date = { Date() },
        stalenessWindow: TimeInterval = 60
    ) -> SecurityStatisticsModel {
        let source = InMemorySecurityStatisticsSource(outcome: outcome, autoResponds: autoResponds)
        let model = SecurityStatisticsModel(source: source, now: now, stalenessWindow: stalenessWindow)
        model.start()
        for extra in thenPush {
            source.push(extra)
        }
        return model
    }

    @MainActor
    private func stalePreviewModel() -> SecurityStatisticsModel {
        let clock = SecurityStatisticsPreviewClock(advance: 600)
        return previewModel(
            outcome: .loaded(previewSnapshot),
            now: { clock.now() },
            stalenessWindow: 60
        )
    }

    #Preview("Loading") {
        SecurityStatistics(model: previewModel(autoResponds: false))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loaded") {
        SecurityStatistics(model: previewModel(outcome: .loaded(previewSnapshot)))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SecurityStatistics(model: previewModel(outcome: .empty))
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SecurityStatistics(
            model: previewModel(outcome: .failure(message: "503 — telemetry collector unavailable"))
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SecurityStatistics(model: stalePreviewModel())
            .frame(width: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SecurityStatistics(
            model: previewModel(
                outcome: .loaded(previewSnapshot),
                thenPush: [.offline(message: "Network unavailable")]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
