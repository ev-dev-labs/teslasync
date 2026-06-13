//
//  WidgetStatGrid.Previews.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  Xcode previews for every real branch of the stat grid: the auto-column grids (a 3-up that the count
//  resolves to three, a 4-up that resolves to four, a 2-up fallback), an explicit `cols` override, the
//  `compact` single column, a single cell, the full trend range (up / down / flat) with mixed value tones
//  and icons, and the empty leaf. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleStats() -> [StatGridItem] {
        [
            StatGridItem(
                label: "Odometer",
                value: "48,213",
                unit: "km",
                iconSystemName: "gauge.with.dots.needle.bottom.50percent",
                trend: StatTrend(direction: .up, value: "+1.4%"),
                valueTone: .primary
            ),
            StatGridItem(
                label: "Efficiency",
                value: "162",
                unit: "Wh/km",
                iconSystemName: "leaf",
                trend: StatTrend(direction: .down, value: "-3.2%"),
                valueTone: .success
            ),
            StatGridItem(
                label: "Charge cost",
                value: "$42.10",
                iconSystemName: "bolt.fill",
                trend: StatTrend(direction: .flat, value: "0%"),
                valueTone: .warning
            )
        ]
    }

    #Preview("Auto 3-up — trends + tones + icons") {
        staged("three stats · autoCols → 3 · up/down/flat · primary/success/warning") {
            WidgetStatGrid(stats: sampleStats())
        }
    }

    #Preview("Auto 4-up — count resolves to four") {
        staged("four stats · autoCols → 4") {
            WidgetStatGrid(
                stats: [
                    StatGridItem(label: "Trips", value: "18", trend: StatTrend(direction: .up, value: "+2")),
                    StatGridItem(label: "Distance", value: "1,420", unit: "km"),
                    StatGridItem(label: "Energy", value: "248", unit: "kWh", valueTone: .accent),
                    StatGridItem(label: "Idle", value: "6", unit: "h", valueTone: .muted)
                ]
            )
        }
    }

    #Preview("Auto 2-up — fallback") {
        staged("five stats · autoCols → 2 fallback") {
            WidgetStatGrid(
                stats: (1 ... 5).map { index in
                    StatGridItem(label: "Metric \(index)", value: "\(index * 7)", unit: "%")
                }
            )
        }
    }

    #Preview("Explicit cols — 3 override") {
        staged("two stats · cols: .three override") {
            WidgetStatGrid(
                stats: [
                    StatGridItem(label: "Range", value: "412", unit: "km", valueTone: .accent),
                    StatGridItem(label: "Battery", value: "82", unit: "%", valueTone: .success)
                ],
                cols: .three
            )
        }
    }

    #Preview("Compact — single column") {
        staged("compact · collapses to one column · condensed gap") {
            WidgetStatGrid(stats: sampleStats(), compact: true)
        }
    }

    #Preview("Single cell") {
        staged("one stat · no trailing columns") {
            WidgetStatGrid(
                stats: [
                    StatGridItem(
                        label: "State of charge",
                        value: "74",
                        unit: "%",
                        iconSystemName: "battery.75percent",
                        trend: StatTrend(direction: .down, value: "-6%"),
                        valueTone: .danger
                    )
                ]
            )
        }
    }

    #Preview("Empty — nothing to show") {
        staged("no stats · friendly empty leaf · never a blank box") {
            WidgetStatGrid(stats: [])
        }
    }
#endif
