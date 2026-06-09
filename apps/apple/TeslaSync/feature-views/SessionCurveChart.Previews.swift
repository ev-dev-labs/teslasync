//
//  SessionCurveChart.Previews.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a DC taper curve),
//  empty (resolved, no selected session / no points → web `EmptyState`), loading
//  (initial skeleton chrome), error (fetch failed → retry), and the stale / offline
//  freshness variants. An AC content variant exercises the flat-curve branch.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSessionCurveTelemetry: SessionCurveChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A realistic DC fast-charge session: a Supercharger taking the pack from 10%
    /// to 90% at a 150 kW peak, so the curve shows the full plateau → taper → roll-off.
    private enum SessionCurvePreviewData {
        static let dcSession = SessionCurveInput(
            startSocPct: 10,
            endSocPct: 90,
            peakPowerW: 150_000,
            chargerType: "Tesla"
        )

        /// A home AC session: a flat 11 kW curve from 40% to 80%.
        static let acSession = SessionCurveInput(
            startSocPct: 40,
            endSocPct: 80,
            peakPowerW: 11000,
            chargerType: nil
        )
    }

    @MainActor
    private func sessionCurvePreview(_ update: SessionCurveChartUpdate) -> SessionCurveChart {
        SessionCurveChart(
            model: SessionCurveChartModel(
                source: InMemorySessionCurveSource(initial: update),
                telemetry: SilentSessionCurveTelemetry()
            )
        )
    }

    #Preview("Content · DC") {
        sessionCurvePreview(
            SessionCurveChartUpdate(status: .loaded, session: SessionCurvePreviewData.dcSession, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Content · AC") {
        sessionCurvePreview(
            SessionCurveChartUpdate(status: .loaded, session: SessionCurvePreviewData.acSession, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        sessionCurvePreview(SessionCurveChartUpdate(status: .loaded, session: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        sessionCurvePreview(SessionCurveChartUpdate(status: .loading, session: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        sessionCurvePreview(
            SessionCurveChartUpdate(status: .failed("Request timed out"), session: nil, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        sessionCurvePreview(
            SessionCurveChartUpdate(status: .loaded, session: SessionCurvePreviewData.dcSession, connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        sessionCurvePreview(
            SessionCurveChartUpdate(status: .loaded, session: SessionCurvePreviewData.dcSession, connection: .offline)
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
