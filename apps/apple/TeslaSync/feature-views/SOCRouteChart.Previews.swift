//
//  SOCRouteChart.Previews.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  Xcode previews — one per state the surface produces: content (a populated SOC
//  route curve with two charge stops + a minimum-arrival line), empty (resolved, no
//  points → web "Plan a trip to see the SOC curve" overlay), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSOCRouteChartTelemetry: SOCRouteChartTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A descending planned-route SOC curve with two charge-stop recoveries, so the
    /// populated previews show a representative multi-leg trip.
    private enum SOCRouteChartPreviewData {
        static let socCurve: [SOCRoutePoint] = [
            SOCRoutePoint(distanceM: 0, soc: 90),
            SOCRoutePoint(distanceM: 40, soc: 74),
            SOCRoutePoint(distanceM: 80, soc: 58),
            SOCRoutePoint(distanceM: 120, soc: 22),
            SOCRoutePoint(distanceM: 120, soc: 80),
            SOCRoutePoint(distanceM: 170, soc: 60),
            SOCRoutePoint(distanceM: 220, soc: 38),
            SOCRoutePoint(distanceM: 250, soc: 18),
            SOCRoutePoint(distanceM: 250, soc: 75),
            SOCRoutePoint(distanceM: 300, soc: 52),
            SOCRoutePoint(distanceM: 340, soc: 33)
        ]

        static let chargeStops: [SOCRouteChargeStop] = [
            SOCRouteChargeStop(chargeFromSoc: 22, name: "Harris Ranch Supercharger"),
            SOCRouteChargeStop(chargeFromSoc: 18, name: "Kettleman City Supercharger")
        ]

        static let minArrivalSoc: Double = 20
    }

    @MainActor
    private func socRoutePreview(_ update: SOCRouteChartUpdate) -> SOCRouteChart {
        SOCRouteChart(
            model: SOCRouteChartModel(
                source: InMemorySOCRouteChartSource(initial: update),
                telemetry: SilentSOCRouteChartTelemetry()
            )
        )
    }

    private func socRouteUpdate(
        status: SOCRouteChartLoadStatus,
        populated: Bool,
        connection: SOCRouteChartConnection
    ) -> SOCRouteChartUpdate {
        SOCRouteChartUpdate(
            status: status,
            socCurve: populated ? SOCRouteChartPreviewData.socCurve : [],
            chargeStops: populated ? SOCRouteChartPreviewData.chargeStops : [],
            minArrivalSoc: SOCRouteChartPreviewData.minArrivalSoc,
            connection: connection
        )
    }

    #Preview("Content") {
        socRoutePreview(socRouteUpdate(status: .loaded, populated: true, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        socRoutePreview(socRouteUpdate(status: .loaded, populated: false, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        socRoutePreview(socRouteUpdate(status: .loading, populated: false, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        socRoutePreview(
            SOCRouteChartUpdate(status: .failed("Request timed out"), connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        socRoutePreview(socRouteUpdate(status: .loaded, populated: true, connection: .stale))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        socRoutePreview(socRouteUpdate(status: .loaded, populated: true, connection: .offline))
            .padding()
            .frame(maxWidth: 480)
    }
#endif
