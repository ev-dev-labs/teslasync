//
//  UptimeHeatmap.Previews.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  Xcode previews for every real branch of the rolling N-day status grid: a high-uptime operational
//  window (green caption, with a maintenance day + summaries), a window with a title override + footnote
//  and a mix of incidents (all five square colours, amber/medium caption), a low-uptime outage window
//  (red caption), and the empty window (the friendly empty state). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope. The sample dates / summaries are illustrative
//  (the embedder supplies the real, localized data).
//

import SwiftUI

#if DEBUG
    private func demoDays(
        _ count: Int,
        anomalies: [Int: UptimeStatus] = [:],
        summaries: [Int: String] = [:]
    ) -> [UptimeDay] {
        (0 ..< count).map { index in
            UptimeDay(
                date: String(format: "2026-06-%02d", index + 1),
                status: anomalies[index] ?? .healthy,
                summary: summaries[index]
            )
        }
    }

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Operational · high uptime") {
        staged("30 days · all up (1 maintenance) · green caption") {
            UptimeHeatmap(
                days: demoDays(
                    30,
                    anomalies: [18: .maintenance],
                    summaries: [18: "Scheduled database maintenance, 02:00–02:30 UTC."]
                )
            )
        }
    }

    #Preview("Title override + footnote · incidents") {
        staged("custom title · mixed statuses · footnote") {
            UptimeHeatmap(
                days: demoDays(
                    30,
                    anomalies: [9: .degraded, 10: .unhealthy, 11: .unknown, 22: .degraded],
                    summaries: [
                        10: "MQTT broker disconnected for 14 minutes.",
                        11: "Telemetry gap — cause under investigation."
                    ]
                ),
                title: "Fleet API availability",
                footnote: "Times shown in UTC. Maintenance windows count as operational."
            )
        }
    }

    #Preview("Outage window · low uptime") {
        staged("frequent outages · red caption") {
            UptimeHeatmap(
                days: demoDays(
                    20,
                    anomalies: [
                        2: .unhealthy, 5: .unhealthy, 6: .degraded, 7: .unhealthy,
                        12: .unhealthy, 15: .degraded, 16: .unhealthy
                    ],
                    summaries: [5: "Sustained 5xx from the command proxy."]
                )
            )
        }
    }

    #Preview("Empty window") {
        staged("no days · friendly empty state") {
            UptimeHeatmap(days: [])
        }
    }
#endif
