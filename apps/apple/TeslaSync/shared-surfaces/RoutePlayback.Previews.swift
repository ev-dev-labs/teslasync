//
//  RoutePlayback.Previews.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  Xcode previews for each surface state (ready / loading / empty / error / stale / offline) plus the
//  no-controls + custom-colour variants and the standalone playhead glyph. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope. All copy resolves through the P1/S10
//  facade so the previews carry no hardcoded literals. A `ManualRoutePlaybackClock` keeps the previews
//  static (no live timer churn).
//

import SwiftUI

#if DEBUG
    enum RoutePlaybackPreviewData {
        /// A short San-Francisco drive with timestamps + speed / SOC metrics.
        static let rows: [RoutePlaybackPointRow] = [
            RoutePlaybackPointRow(lat: 37.7749, lng: -122.4194, timestamp: "2026-01-01T00:00:00Z", speed: 0, soc: 82),
            RoutePlaybackPointRow(
                lat: 37.7769,
                lng: -122.4185,
                timestamp: "2026-01-01T00:00:30Z",
                speed: 32.5,
                soc: 81
            ),
            RoutePlaybackPointRow(lat: 37.7795, lng: -122.4150, timestamp: "2026-01-01T00:01:10Z", speed: 48, soc: 80),
            RoutePlaybackPointRow(
                lat: 37.7820,
                lng: -122.4110,
                timestamp: "2026-01-01T00:02:00Z",
                speed: 41.2,
                soc: 79
            ),
            RoutePlaybackPointRow(lat: 37.7841, lng: -122.4075, timestamp: "2026-01-01T00:02:45Z", speed: 0, soc: 78)
        ]
    }

    @MainActor
    private func routePlaybackPreviewModel(
        _ input: RoutePlaybackInput,
        content: RoutePlaybackContent = RoutePlaybackContent()
    ) -> RoutePlaybackModel {
        RoutePlaybackModel(
            content: content,
            source: InMemoryRoutePlaybackSource(initial: input),
            clock: ManualRoutePlaybackClock()
        )
    }

    @MainActor
    private func routePlaybackStaged(
        connection: RoutePlaybackConnection,
        phase: RoutePlaybackLoadPhase,
        rows: [RoutePlaybackPointRow]?,
        content: RoutePlaybackContent = RoutePlaybackContent()
    ) -> some View {
        let input = RoutePlaybackInput(connection: connection, phase: phase, rows: rows)
        return RoutePlayback(model: routePlaybackPreviewModel(input, content: content))
            .padding()
            .frame(maxWidth: 540)
            .background(Color.TS.bg)
    }

    #Preview("Ready") {
        routePlaybackStaged(connection: .live, phase: .loaded, rows: RoutePlaybackPreviewData.rows)
    }

    #Preview("Ready — custom trail colour") {
        routePlaybackStaged(
            connection: .live,
            phase: .loaded,
            rows: RoutePlaybackPreviewData.rows,
            content: RoutePlaybackContent(trailColorHex: "#10b981", markerColorHex: "#f59e0b")
        )
    }

    #Preview("Ready — no controls") {
        routePlaybackStaged(
            connection: .live,
            phase: .loaded,
            rows: RoutePlaybackPreviewData.rows,
            content: RoutePlaybackContent(showsControls: false)
        )
    }

    #Preview("Loading") {
        routePlaybackStaged(connection: .live, phase: .loading, rows: nil)
    }

    #Preview("Empty") {
        routePlaybackStaged(connection: .live, phase: .loaded, rows: [])
    }

    #Preview("Error") {
        routePlaybackStaged(connection: .live, phase: .failed, rows: RoutePlaybackPreviewData.rows)
    }

    #Preview("Stale") {
        routePlaybackStaged(connection: .stale, phase: .loaded, rows: RoutePlaybackPreviewData.rows)
    }

    #Preview("Offline") {
        routePlaybackStaged(connection: .offline, phase: .loaded, rows: RoutePlaybackPreviewData.rows)
    }

    #Preview("Playhead glyph") {
        HStack(spacing: TSSpacing.x3xl) {
            RoutePlaybackPlayheadGlyph(color: Color.TS.accent, heading: 45)
            RoutePlaybackPlayheadGlyph(
                color: RoutePlaybackPalette.parse("#f59e0b")?.color ?? Color.TS.accent,
                heading: 220
            )
        }
        .padding(TSSpacing.x3xl)
        .background(Color.TS.bg)
    }
#endif
