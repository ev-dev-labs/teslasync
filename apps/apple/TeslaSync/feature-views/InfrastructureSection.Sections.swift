//
//  InfrastructureSection.Sections.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  The two content cards + the database-pool metric row composed by
//  `InfrastructureSection`, the SwiftUI parity of the web body:
//    1. SSE Connection — the web first `<Card>`: a header (title + Wifi/WifiOff icon)
//       over a `<KVList>` (Connection State badge / Endpoint / Protocol / Fallback
//       Mode).
//    2. Polling Engine — the web second `<Card>`: a header (title + Active/Standby
//       badge) over a `<KVList>` (Mode / Speed Comparison / Fleet Telemetry Latency /
//       Fleet API Polling).
//    3. Database pool — the web `{extHealth?.database_pool && …}` 3-column grid of
//       `<InlineMetric>`s (Total Conns / Acquired / Idle).
//  Copy resolves through the P1/S10 facade; chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - 1 · SSE Connection (web first `<Card>`)

/// The SSE Connection card — a header (title + the connected/disconnected Wifi icon)
/// over the connection-state badge and the endpoint / protocol / fallback rows.
struct InfraSSEConnectionCard: View {
    let info: InfraSSEInfo

    private var fallbackValue: String {
        info.fallbackActive
            ? InfrastructureStrings.string("Yes — Polling", "Yes — Polling")
            : InfrastructureStrings.string("No", "No")
    }

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                InfraSectionCardHeader(titleKey: "SSE Connection", titleFallback: "SSE Connection") {
                    Image(systemName: info.connected ? "wifi" : "wifi.slash")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(info.connected ? Color.TS.statusSuccess : Color.TS.statusDanger)
                        .accessibilityHidden(true)
                }
                InfraKVRow(labelKey: "Connection State", labelFallback: "Connection State") {
                    InfraStateBadge(
                        titleKey: info.connected ? "Connected" : "Disconnected",
                        fallback: info.connected ? "Connected" : "Disconnected",
                        tone: info.connected ? .success : .danger
                    )
                }
                InfraKVRow(labelKey: "Endpoint", labelFallback: "Endpoint") {
                    InfraKVValue(text: info.endpoint)
                }
                InfraKVRow(labelKey: "Protocol", labelFallback: "Protocol") {
                    InfraKVValue(text: info.protocolName)
                }
                InfraKVRow(labelKey: "Fallback Mode", labelFallback: "Fallback Mode") {
                    InfraKVValue(text: fallbackValue)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: InfrastructureAccessibility.sseLabel(
            info,
            localize: InfrastructureStrings.string
        )))
    }
}

// MARK: - 2 · Polling Engine (web second `<Card>`)

/// The Polling Engine card — a header (title + the Active/Standby badge) over the raw
/// mode and the three speed-comparison rows.
struct InfraPollingEngineCard: View {
    let info: InfraPollingInfo

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                InfraSectionCardHeader(titleKey: "Polling Engine", titleFallback: "Polling Engine") {
                    InfraStateBadge(
                        titleKey: info.active ? "Active" : "Standby",
                        fallback: info.active ? "Active" : "Standby",
                        tone: info.active ? .success : .neutral
                    )
                }
                InfraKVRow(labelKey: "Mode", labelFallback: "Mode") {
                    InfraKVValue(text: info.mode)
                }
                InfraKVRow(labelKey: "Speed Comparison", labelFallback: "Speed Comparison") {
                    InfraKVValue(text: info.speedup)
                }
                InfraKVRow(labelKey: "Fleet Telemetry Latency", labelFallback: "Fleet Telemetry Latency") {
                    InfraKVValue(text: info.fleetTelemetryLatency)
                }
                InfraKVRow(labelKey: "Fleet API Polling", labelFallback: "Fleet API Polling") {
                    InfraKVValue(text: info.fleetApiPolling)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: InfrastructureAccessibility.pollingLabel(
            info,
            localize: InfrastructureStrings.string
        )))
    }
}

// MARK: - 3 · Database pool (web `<InlineMetric>` grid)

/// The database connection-pool row — the web `{extHealth?.database_pool && …}`
/// 3-column grid of inline metrics (Total Conns / Acquired / Idle). Rendered only when
/// the source has a pool snapshot (the caller guards on `poolStats != nil`).
struct InfraConnectionPoolRow: View {
    let stats: [InfraPoolStat]

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md, alignment: .top),
        count: 3
    )

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(stats) { stat in
                InfraMetricTile(stat: stat)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
