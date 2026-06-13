//
//  ResourcesPanel.Previews.swift
//  TeslaSync — P4 shared surface · 0198 · ResourcesPanel (Apple)
//
//  Xcode previews for every real branch of the server-resources panel: the normal / warn / critical
//  severities (each recolouring its bar + value), rows with no bar (label + value only), rows with an
//  icon + sub-label, a row whose long label truncates, a footnote, and the empty-rows friendly state.
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope. The sample
//  labels / values are illustrative (the embedder supplies the real, localized strings).
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Severities · normal / warn / critical") {
        staged("green < 70 % · amber ≥ 70 % · red ≥ 90 % bars + value tint") {
            ResourcesPanel(rows: [
                ResourceRow(
                    label: "Memory",
                    valueText: "1.8 GB",
                    metaText: "of 8 GB",
                    percent: 22,
                    icon: { Image(systemName: "memorychip") }
                ),
                ResourceRow(
                    label: "DB pool",
                    valueText: "18",
                    metaText: "of 25",
                    percent: 72,
                    icon: { Image(systemName: "cylinder.split.1x2") }
                ),
                ResourceRow(
                    label: "Disk",
                    valueText: "94 GB",
                    metaText: "of 100 GB",
                    percent: 94,
                    icon: { Image(systemName: "internaldrive") }
                )
            ])
        }
    }

    #Preview("No-bar rows · icon / sub-label variants") {
        staged("rows without a percent render label + value only (no bar)") {
            ResourcesPanel(rows: [
                ResourceRow(
                    label: "Goroutines",
                    valueText: "248",
                    icon: { Image(systemName: "point.3.connected.trianglepath.dotted") }
                ),
                ResourceRow(label: "Uptime", valueText: "12d 4h"),
                ResourceRow(
                    label: "Open files",
                    valueText: "1,204",
                    metaText: "soft 4,096"
                )
            ]) {
                Text(verbatim: "CPU % and disk I/O not yet exposed by the backend.")
            }
        }
    }

    #Preview("Truncation · long label") {
        staged("the flexible label truncates · the value + sub-label hold their width") {
            ResourcesPanel(rows: [
                ResourceRow(
                    label: "Resident set size of the long-running API process",
                    valueText: "2.4 GB",
                    metaText: "of 8 GB",
                    percent: 31,
                    icon: { Image(systemName: "gauge.with.dots.needle.67percent") }
                )
            ])
        }
    }

    #Preview("Empty · friendly state") {
        staged("no rows → friendly empty state, never a blank box") {
            ResourcesPanel(rows: [])
        }
    }
#endif
