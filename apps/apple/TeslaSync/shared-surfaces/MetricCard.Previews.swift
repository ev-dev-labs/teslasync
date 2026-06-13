//
//  MetricCard.Previews.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  Xcode previews for every branch of the metric card: the six accent colors, the text vs number
//  value, the legacy change pill (up / down), the delta footer in each arm (percent / absolute / both
//  / loading / empty, across higher-/lower-/neutral-direction), the subtitle, the help "?" affordance,
//  and the icon box. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
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
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let helpDocURL = URL(string: "https://teslasync.io/docs/metrics")

    #Preview("Accent colors") {
        staged("six NeonColor accents") {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: TSSpacing.md) {
                MetricCard(label: "Range", value: 312, iconSystemName: "bolt.fill", color: .cyan)
                MetricCard(label: "Efficiency", value: 268, iconSystemName: "leaf.fill", color: .green)
                MetricCard(label: "Errors", value: 3, iconSystemName: "exclamationmark.triangle.fill", color: .red)
                MetricCard(label: "Sessions", value: 18, iconSystemName: "battery.100.bolt", color: .purple)
                MetricCard(label: "Idle", value: 5, iconSystemName: "moon.fill", color: .amber)
                MetricCard(label: "Trips", value: 42, iconSystemName: "map.fill", color: .blue)
            }
        }
    }

    #Preview("Value: text vs number") {
        staged("string + number values") {
            VStack(spacing: TSSpacing.md) {
                MetricCard(label: "Distance", value: "48,210 km", iconSystemName: "road.lanes")
                MetricCard(label: "Odometer", value: 132_004, iconSystemName: "gauge.with.dots.needle.bottom.50percent")
            }
        }
    }

    #Preview("Legacy change pill") {
        staged("change && !delta") {
            VStack(spacing: TSSpacing.md) {
                MetricCard(
                    label: "Range",
                    value: "312 mi",
                    iconSystemName: "bolt.fill",
                    change: MetricCardChange(value: "4.2%", positive: true)
                )
                MetricCard(
                    label: "Vampire drain",
                    value: "1.1%/day",
                    iconSystemName: "thermometer.snowflake",
                    color: .amber,
                    change: MetricCardChange(value: "0.3%", positive: false)
                )
            }
        }
    }

    #Preview("Delta footer") {
        staged("percent / absolute / both / empty / loading") {
            VStack(spacing: TSSpacing.md) {
                MetricCard(
                    label: "Efficiency",
                    value: 268,
                    iconSystemName: "leaf.fill",
                    color: .green,
                    delta: MetricCardDelta(
                        direction: .lowerBetter, previous: 281,
                        comparedTo: "vs last month", unitSuffix: "Wh/mi"
                    )
                )
                MetricCard(
                    label: "Range",
                    value: 312,
                    delta: MetricCardDelta(
                        direction: .higherBetter, previous: 298,
                        display: .both, comparedTo: "vs last week", unitSuffix: "mi"
                    )
                )
                MetricCard(
                    label: "Cost",
                    value: 42.5,
                    color: .amber,
                    delta: MetricCardDelta(
                        direction: .lowerBetter, previous: 39.0,
                        display: .absolute, unitPrefix: "$", precision: 2
                    )
                )
                MetricCard(
                    label: "Sessions",
                    value: 18,
                    delta: MetricCardDelta(direction: .neutral, previous: nil, comparedTo: "vs last week")
                )
                MetricCard(
                    label: "Loading",
                    value: 0,
                    delta: MetricCardDelta(direction: .higherBetter, previous: 1, loading: true)
                )
            }
        }
    }

    #Preview("Subtitle + help") {
        staged("subtitle + '?' tooltip") {
            VStack(spacing: TSSpacing.md) {
                MetricCard(
                    label: "Battery health",
                    value: "94%",
                    iconSystemName: "heart.fill",
                    color: .green,
                    subtitle: "since last charge",
                    help: MetricCardHelp(
                        text: "Estimated usable capacity versus the original pack capacity.",
                        learnMore: helpDocURL.map { MetricCardLearnMore(url: $0) }
                    )
                )
                MetricCard(
                    label: "Vampire drain",
                    value: "1.1%/day",
                    color: .amber,
                    subtitle: "rolling 7-day average",
                    help: MetricCardHelp(text: "Idle energy loss while parked and not plugged in.")
                )
            }
        }
    }
#endif
