//
//  ChartTimeRangeContext.Views.swift
//  TeslaSync — P4 shared surface · 0069 · ChartTimeRangeContext (Apple)
//
//  The presentational pieces of the cursor-sync surface: the persistent reference-line mark (the
//  native parity of the web `<ReferenceLine x={syncedX} />` every synced chart renders) and a
//  DEBUG-only sample that wires two synced charts plus one standalone chart so the previews + the
//  view-composition tests have a concrete reference implementation. The sample is exactly what a real
//  chart copies: a `.chartXSelection` that broadcasts the local hover into the shared store and a
//  `tsSyncedCursorRule` inside the `Chart { … }` that draws the shared cursor. All copy resolves
//  through P1/S10; all chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//

import Charts
import SwiftUI

// MARK: - Persistent reference line (web `<ReferenceLine x={syncedX} />`)

/// Draws the shared persistent cursor inside a `Chart { … }` — the native parity of the web
/// `useSyncedReferenceLineX()` → `<ReferenceLine x={syncedX} />`. Renders nothing when no cursor is
/// set (web `syncedX != null && …`), so a chart embeds it unconditionally. Handles both a numeric x
/// (the `syncMethod == .value` / index path) and a category-string x.
@ChartContentBuilder
public func tsSyncedCursorRule(
    at value: CursorSyncValue?,
    label: String = "cursor"
) -> some ChartContent {
    if let value {
        switch value {
        case let .number(number):
            RuleMark(x: .value(label, number))
                .foregroundStyle(Color.TS.accent.opacity(0.8))
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        case let .text(text):
            RuleMark(x: .value(label, text))
                .foregroundStyle(Color.TS.accent.opacity(0.8))
                .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
        }
    }
}

#if DEBUG

    // MARK: - Sample data (DEBUG previews + view-composition tests)

    /// One sample row used by the DEBUG sample charts — a stand-in for the shared `chartData` the web
    /// drive-detail page feeds every synced chart.
    struct ChartTimeRangeSamplePoint: Identifiable {
        let index: Int
        let value: Double

        var id: Int {
            index
        }
    }

    enum ChartTimeRangeSampleData {
        static let seriesA: [ChartTimeRangeSamplePoint] = (0 ..< 24).map { step in
            ChartTimeRangeSamplePoint(
                index: step,
                value: 60 + 30 * sin(Double(step) / 3.5)
            )
        }

        static let seriesB: [ChartTimeRangeSamplePoint] = (0 ..< 24).map { step in
            ChartTimeRangeSamplePoint(
                index: step,
                value: 20 + 14 * cos(Double(step) / 2.5)
            )
        }
    }

    // MARK: - Sample synced chart (the reference wiring a real chart copies)

    /// A single synced sample chart. It reads the shared context from the environment (web
    /// `useChartSync()`), broadcasts its hover into the store (web `useSyncedCursor.onMouseMove`), and
    /// draws the shared persistent reference line (web `useSyncedReferenceLineX`). Outside a provider
    /// `sync` is `nil`, so it renders as an ordinary standalone chart — the faithful "no context"
    /// branch.
    struct ChartTimeRangeSampleChart: View {
        let titleKey: String
        let titleFallback: String
        let points: [ChartTimeRangeSamplePoint]
        let colorIndex: Int

        @Environment(\.chartSyncContext) private var sync
        @State private var selection: Int?

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: ChartTimeRangeStrings.string(titleKey, titleFallback))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                chart
            }
        }

        private var chart: some View {
            Chart {
                ForEach(points) { point in
                    LineMark(
                        x: .value(xAxisLabel, point.index),
                        y: .value(yAxisLabel, point.value)
                    )
                    .foregroundStyle(TSChartPalette.color(at: colorIndex))
                    .interpolationMethod(.monotone)
                }
                tsSyncedCursorRule(at: sync?.referenceLineX, label: xAxisLabel)
            }
            .chartXSelection(value: $selection)
            .onChange(of: selection) { _, newValue in
                guard let newValue else { return }
                sync?.moveCursor(to: CursorSyncValue(index: newValue))
            }
            .chartLegend(.hidden)
            .frame(height: 120)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: ChartTimeRangeStrings.string(
                "chartTimeRange.sample.chart.aria",
                "Synced sample line chart"
            )))
            .accessibilityValue(Text(verbatim: cursorAccessibilityValue))
        }

        private var xAxisLabel: String {
            ChartTimeRangeStrings.string("chartTimeRange.sample.axis.x", "Sample")
        }

        private var yAxisLabel: String {
            ChartTimeRangeStrings.string("chartTimeRange.sample.axis.y", "Value")
        }

        /// The VoiceOver readout of the shared cursor — present so the synced state is announced, not
        /// just drawn.
        private var cursorAccessibilityValue: String {
            guard let index = sync?.referenceLineX?.numberValue else {
                return ChartTimeRangeStrings.string(
                    "chartTimeRange.sample.cursor.none",
                    "No shared cursor"
                )
            }
            let template = ChartTimeRangeStrings.string(
                "chartTimeRange.sample.cursor.at",
                "Shared cursor at sample %d"
            )
            return String(format: template, Int(index))
        }
    }

    // MARK: - Sample composite (previews + tests)

    /// The DEBUG sample composite: two charts inside one ``ChartTimeRangeProvider`` (so a hover on one
    /// moves the reference line on both) plus a third standalone chart outside any provider (the
    /// faithful "no context" branch). Drives a fresh ``CursorSyncStore`` so it never touches global
    /// state.
    struct ChartTimeRangeContextSample: View {
        let syncId: String
        let syncMethod: ChartSyncMethod
        @State private var store: CursorSyncStore

        init(
            syncId: String = "chart-time-range-sample",
            syncMethod: ChartSyncMethod = .index
        ) {
            self.syncId = syncId
            self.syncMethod = syncMethod
            _store = State(initialValue: CursorSyncStore())
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                ChartTimeRangeProvider(syncId: syncId, syncMethod: syncMethod, store: store) {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        ChartTimeRangeSampleChart(
                            titleKey: "chartTimeRange.sample.series.battery",
                            titleFallback: "Battery (synced)",
                            points: ChartTimeRangeSampleData.seriesA,
                            colorIndex: 0
                        )
                        ChartTimeRangeSampleChart(
                            titleKey: "chartTimeRange.sample.series.power",
                            titleFallback: "Power (synced)",
                            points: ChartTimeRangeSampleData.seriesB,
                            colorIndex: 5
                        )
                    }
                }
                ChartTimeRangeSampleChart(
                    titleKey: "chartTimeRange.sample.series.standalone",
                    titleFallback: "Standalone (no provider)",
                    points: ChartTimeRangeSampleData.seriesA,
                    colorIndex: 2
                )
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
        }
    }
#endif
