//
//  SessionComparisonChart.Previews.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (overlaid curves),
//  empty (resolved, no sessions → friendly state), loading (initial skeleton chrome),
//  error (fetch failed → retry), and the stale / offline freshness variants.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSessionComparisonTelemetry: SessionComparisonTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample sessions for the populated previews: a Supercharger DC taper, a slower
    /// DC stall, and a flat home-AC line, plus a couple more to exercise the palette.
    private enum SessionComparisonPreviewData {
        static func date(_ month: Int, _ day: Int) -> Date {
            var components = DateComponents()
            components.year = 2026
            components.month = month
            components.day = day
            components.hour = 12
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
            return calendar.date(from: components) ?? Date()
        }

        static let sessions: [ComparisonSession] = [
            ComparisonSession(
                id: 1, startedAt: date(6, 1), startSocPct: 8, endSocPct: 100,
                peakPowerW: 250_000, chargerType: "Tesla"
            ),
            ComparisonSession(
                id: 2, startedAt: date(6, 2), startSocPct: 20, endSocPct: 90,
                peakPowerW: 150_000, chargerType: "CCS"
            ),
            ComparisonSession(
                id: 3, startedAt: date(6, 3), startSocPct: 40, endSocPct: 80,
                peakPowerW: 11000, chargerType: nil
            ),
            ComparisonSession(
                id: 4, startedAt: date(6, 4), startSocPct: 12, endSocPct: 95,
                peakPowerW: 120_000, chargerType: "Supercharger V3"
            ),
            ComparisonSession(
                id: 5, startedAt: date(6, 5), startSocPct: 30, endSocPct: 100,
                peakPowerW: 7400, chargerType: nil
            )
        ]
    }

    @MainActor
    private func sessionComparisonPreview(_ update: ComparisonUpdate) -> SessionComparisonChart {
        SessionComparisonChart(
            model: SessionComparisonChartModel(
                source: InMemorySessionComparisonSource(initial: update),
                telemetry: SilentSessionComparisonTelemetry(),
                locale: Locale(identifier: "en_US_POSIX"),
                timeZone: TimeZone(identifier: "UTC") ?? .current
            )
        )
    }

    #Preview("Content") {
        sessionComparisonPreview(
            ComparisonUpdate(status: .loaded, sessions: SessionComparisonPreviewData.sessions, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        sessionComparisonPreview(ComparisonUpdate(status: .loaded, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        sessionComparisonPreview(ComparisonUpdate(status: .loading, sessions: [], connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        sessionComparisonPreview(
            ComparisonUpdate(status: .failed("Request timed out"), sessions: [], connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        sessionComparisonPreview(
            ComparisonUpdate(status: .loaded, sessions: SessionComparisonPreviewData.sessions, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        sessionComparisonPreview(
            ComparisonUpdate(status: .loaded, sessions: SessionComparisonPreviewData.sessions, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
