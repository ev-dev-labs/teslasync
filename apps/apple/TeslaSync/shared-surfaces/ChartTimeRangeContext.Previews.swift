//
//  ChartTimeRangeContext.Previews.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  Xcode previews for every real branch of the cursor-sync surface: the live synced composite (tap a
//  chart to move the shared cursor on both), a provider with a cursor preset so the persistent
//  reference line is visible without interaction, a provider with no cursor (no line), the
//  `syncMethod == .value` variant, and a standalone chart with no provider (the faithful "no context"
//  branch). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func seededStore(cursorAt index: Int?, syncId: String) -> CursorSyncStore {
        let store = CursorSyncStore()
        if let index {
            store.setPosition(CursorSyncValue(index: index), for: syncId)
        }
        return store
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
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Synced composite · index") {
        ChartTimeRangeContextSample(syncId: "preview-composite-index", syncMethod: .index)
    }

    #Preview("Synced composite · value") {
        ChartTimeRangeContextSample(syncId: "preview-composite-value", syncMethod: .value)
    }

    #Preview("Cursor preset (persistent line)") {
        staged("provider · cursor preset at sample 8") {
            ChartTimeRangeProvider(
                syncId: "preview-seeded",
                store: seededStore(cursorAt: 8, syncId: "preview-seeded")
            ) {
                ChartTimeRangeSampleChart(
                    titleKey: "chartTimeRange.sample.series.battery",
                    titleFallback: "Battery (synced)",
                    points: ChartTimeRangeSampleData.seriesA,
                    colorIndex: 0
                )
            }
        }
    }

    #Preview("Cursor cleared (no line)") {
        staged("provider · no cursor yet") {
            ChartTimeRangeProvider(
                syncId: "preview-empty",
                store: seededStore(cursorAt: nil, syncId: "preview-empty")
            ) {
                ChartTimeRangeSampleChart(
                    titleKey: "chartTimeRange.sample.series.power",
                    titleFallback: "Power (synced)",
                    points: ChartTimeRangeSampleData.seriesB,
                    colorIndex: 5
                )
            }
        }
    }

    #Preview("Standalone (no provider)") {
        staged("no provider · context is nil") {
            ChartTimeRangeSampleChart(
                titleKey: "chartTimeRange.sample.series.standalone",
                titleFallback: "Standalone (no provider)",
                points: ChartTimeRangeSampleData.seriesA,
                colorIndex: 2
            )
        }
    }
#endif
