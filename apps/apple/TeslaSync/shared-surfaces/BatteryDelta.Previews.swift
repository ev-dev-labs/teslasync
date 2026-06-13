//
//  BatteryDelta.Previews.swift
//  TeslaSync — P4 shared surface · 0077 · BatteryDelta (Apple)
//
//  Xcode previews for every real branch of the battery delta: the populated compact rise / drop /
//  zero, the pair variant, the icon-less form, and the no-data ("—") branch. DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
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

    #Preview("Compact · rise / drop / zero") {
        staged("compact variant") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BatteryDelta(startPct: 20, endPct: 80)
                BatteryDelta(startPct: 79, endPct: 78)
                BatteryDelta(startPct: 80, endPct: 80)
            }
        }
    }

    #Preview("Pair variant") {
        staged("pair variant · A% → B%") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BatteryDelta(startPct: 20, endPct: 80, variant: .pair)
                BatteryDelta(startPct: 79, endPct: 78, variant: .pair)
                BatteryDelta(startPct: 80, endPct: 80, variant: .pair)
            }
        }
    }

    #Preview("No data (—)") {
        staged("missing / non-finite endpoints") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BatteryDelta(startPct: nil, endPct: 80)
                BatteryDelta(startPct: 80, endPct: nil)
                BatteryDelta(startPct: .nan, endPct: 80)
            }
        }
    }

    #Preview("No icon") {
        staged("showIcon: false") {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                BatteryDelta(startPct: 18, endPct: 72, showIcon: false)
                BatteryDelta(startPct: 90, endPct: 89, showIcon: false, variant: .pair)
            }
        }
    }
#endif
