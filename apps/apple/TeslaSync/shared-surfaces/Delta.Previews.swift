//
//  Delta.Previews.swift
//  TeslaSync — P4 shared surface · 0081 · Delta (Apple)
//
//  Xcode previews for every branch of the change indicator: the percent / absolute / both display
//  forms across higher-/lower-/neutral-direction metrics, the empty (missing comparison) and loading
//  arms, the `hideArrow` and `comparedTo` options, the sm / md sizes, and the unit-affix resolution
//  under both metric and imperial preferences (the currency, efficiency, and distance affixes flip
//  with `\.tsUnits`). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
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

    #Preview("Percent — direction tones") {
        staged("higher / lower / neutral · percent") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Delta(metric: .id("range"), current: 312, previous: 298, comparedTo: "vs last week")
                Delta(metric: .id("efficiency"), current: 268, previous: 281, comparedTo: "vs last month")
                Delta(metric: .id("range"), current: 290, previous: 298)
                Delta(metric: .id("distance"), current: 1420, previous: 1360, comparedTo: "vs last month")
            }
        }
        .tsUnits(.imperial)
    }

    #Preview("Absolute / both / zero") {
        staged("absolute · both · zero-delta") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Delta(
                    metric: .id("cost"),
                    current: 42.5,
                    previous: 39.0,
                    display: .absolute,
                    precision: 2
                )
                Delta(metric: .id("range"), current: 312, previous: 298, display: .both)
                Delta(metric: .id("range"), current: 100, previous: 100, comparedTo: "vs last week")
                Delta(
                    metric: .inline(direction: .lowerBetter, unit: .whPerMi),
                    current: 268,
                    previous: 281,
                    display: .absolute
                )
            }
        }
        .tsUnits(.imperial)
    }

    #Preview("Empty / loading / hideArrow") {
        staged("missing data · skeleton · no arrow") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Delta(metric: .id("range"), current: nil, previous: 298, comparedTo: "vs last week")
                Delta(metric: .id("range"), current: 312, previous: 0)
                Delta(metric: .id("range"), current: 312, previous: 298, loading: true)
                Delta(metric: .id("range"), current: 312, previous: 298, hideArrow: true)
            }
        }
    }

    #Preview("Sizes + metric units") {
        staged("sm vs md · metric affixes") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Delta(metric: .id("range"), current: 502, previous: 480, comparedTo: "vs last week", size: .sm)
                Delta(metric: .id("range"), current: 502, previous: 480, comparedTo: "vs last week", size: .md)
                Delta(metric: .id("battery_health_pct"), current: 94, previous: 95, display: .absolute)
            }
        }
        .tsUnits(.metric)
    }
#endif
