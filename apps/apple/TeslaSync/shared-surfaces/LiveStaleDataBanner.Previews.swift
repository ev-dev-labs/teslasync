//
//  LiveStaleDataBanner.Previews.swift
//  TeslaSync — P4 shared surface · 0126 · LiveStaleDataBanner (Apple)
//
//  Xcode previews for each surface state (loading, healthy-connected, healthy-reconnecting,
//  healthy-recent-disconnect, the stale-data warning banner, the warning banner with a stale status
//  reading, and the error tile). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum LiveStalePreviewClock {
        /// A fixed "now" so the disconnected previews render the banner deterministically.
        static let now = Date(timeIntervalSince1970: 1_700_000_000)
        static let clock: @Sendable () -> Date = { now }

        static func ago(_ seconds: TimeInterval) -> Date {
            now.addingTimeInterval(-seconds)
        }
    }

    #Preview("Loading") {
        LiveStaleDataBanner(status: .unknown, clock: LiveStalePreviewClock.clock)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Healthy — connected") {
        LiveStaleDataBanner(status: .connected, clock: LiveStalePreviewClock.clock)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Healthy — reconnecting") {
        LiveStaleDataBanner(status: .reconnecting, clock: LiveStalePreviewClock.clock)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Healthy — recent disconnect") {
        LiveStaleDataBanner(
            status: .disconnected,
            statusSince: LiveStalePreviewClock.ago(20),
            clock: LiveStalePreviewClock.clock
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale — warning banner") {
        LiveStaleDataBanner(
            status: .disconnected,
            statusSince: LiveStalePreviewClock.ago(180),
            clock: LiveStalePreviewClock.clock
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale — stale reading") {
        LiveStaleDataBanner(
            status: .disconnected,
            statusSince: LiveStalePreviewClock.ago(600),
            freshness: .stale,
            clock: LiveStalePreviewClock.clock
        )
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveStaleDataBanner(
            status: .unknown,
            errorMessage: "The live status transport is unavailable",
            clock: LiveStalePreviewClock.clock
        )
        .padding()
        .background(Color.TS.bg)
    }
#endif
