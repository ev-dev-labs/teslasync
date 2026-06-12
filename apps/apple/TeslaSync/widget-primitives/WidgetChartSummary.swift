//
//  WidgetChartSummary.swift
//  TeslaSync — P4 widget primitive · 0002 · WidgetChartSummary (Apple)
//
//  The SwiftUI surface — native parity of features/dashboard/widgets/shared/WidgetChartSummary.tsx.
//  A shared widget building block: a responsive stat row above a caller-supplied chart slot, a
//  stats-only compact variant, and a friendly empty state (web `@/components/feedback` EmptyState
//  → `ContentUnavailableView`). Pure presentation — no networking, no data source.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension WidgetChartSummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model stays SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - WidgetChartSummary (the primitive)

/// A composable chart-summary widget building block. Renders, faithfully to the web source:
///   • an empty state (`isEmpty`) — a `ContentUnavailableView` with the supplied icon + message;
///   • otherwise a stat row (when `stats` is non-empty) that is a 2-column grid by default and
///     relaxes into a horizontal row past the `@sm` breakpoint (suppressed-to-grid in compact);
///   • the caller's `chart` slot below the stats, expanding to fill the remaining height, shown
///     only outside compact mode (web `{!compact && …}`).
///
/// The view emits the P1/S11 `view.opened` diagnostic on appear and binds no data (the hosting
/// widget supplies every input), matching the web presentational component.
public struct WidgetChartSummary<Chart: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        "WidgetChartSummary"
    }

    private let stats: [ChartSummaryStat]
    private let compact: Bool
    private let isEmpty: Bool
    private let emptyMessage: String?
    private let emptySystemImage: String
    private let telemetry: any WidgetChartSummaryTelemetry
    private let chart: @MainActor () -> Chart

    public init(
        stats: [ChartSummaryStat],
        compact: Bool = false,
        isEmpty: Bool = false,
        emptyMessage: String? = nil,
        emptySystemImage: String = "chart.bar.xaxis",
        telemetry: any WidgetChartSummaryTelemetry = OSLogWidgetChartSummaryTelemetry(),
        @ViewBuilder chart: @escaping @MainActor () -> Chart
    ) {
        self.stats = stats
        self.compact = compact
        self.isEmpty = isEmpty
        self.emptyMessage = emptyMessage
        self.emptySystemImage = emptySystemImage
        self.telemetry = telemetry
        self.chart = chart
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .onAppear { telemetry.viewOpened(surface: Self.surfaceSlug) }
    }

    @ViewBuilder private var content: some View {
        if isEmpty {
            emptyState
        } else {
            // Web `flex h-full flex-col`: stat row pinned to the top, chart filling the rest.
            VStack(alignment: .leading, spacing: 0) {
                if WidgetChartSummaryLayout.showsStats(stats) {
                    WidgetChartSummaryStatsView(stats: stats, compact: compact)
                }
                if WidgetChartSummaryLayout.showsChart(compact: compact) {
                    chart()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .padding(.top, TSSpacing.sm) // web `mt-2`
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private var resolvedEmptyMessage: String {
        emptyMessage ?? WidgetChartSummaryStrings.string("widget.chartSummary.noData", "No data available")
    }

    /// Web `<EmptyState icon={emptyIcon} message={emptyMessage ?? 'No data available'} />`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: resolvedEmptyMessage)
            } icon: {
                Image(systemName: emptySystemImage)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityLabel(Text(verbatim: resolvedEmptyMessage))
    }
}

// MARK: - Responsive stat row

/// The stat row above the chart (and the whole body in compact mode) — the native port of the web
/// `WidgetChartSummary` stat grid. Holds only value-type inputs so it stays `Sendable`; it measures
/// its own width to switch between the 2-column grid (web default / compact) and the horizontal row
/// (web `@sm:flex`).
struct WidgetChartSummaryStatsView: View {
    let stats: [ChartSummaryStat]
    let compact: Bool

    @State private var availableWidth: CGFloat = 0

    var body: some View {
        statLayout
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { proxy in
                proxy.size.width
            } action: { newWidth in
                availableWidth = newWidth
            }
            .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var statLayout: some View {
        if WidgetChartSummaryLayout.usesRow(availableWidth: availableWidth, compact: compact) {
            // Web `@sm:flex @sm:gap-4`: content-sized cells packed to the leading edge.
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                ForEach(stats) { stat in
                    statCell(stat)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            // Web `grid grid-cols-2 gap-2`: two flexible, leading-aligned columns.
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
                    GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading)
                ],
                alignment: .leading,
                spacing: TSSpacing.sm
            ) {
                ForEach(stats) { stat in
                    statCell(stat)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    /// Web `<div class="flex min-w-0 flex-col"><span class="truncate text-[10px]…">label</span>
    /// <span class="truncate text-sm font-semibold…">value<span unit/></span></div>`.
    private func statCell(_ stat: ChartSummaryStat) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: stat.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(verbatim: stat.value)
                    .font(Font.TS.body.weight(.semibold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
                if let unit = stat.unit, !unit.isEmpty {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
        }
        .frame(minWidth: 0, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WidgetChartSummaryAccessibility.statLabel(for: stat)))
    }
}
