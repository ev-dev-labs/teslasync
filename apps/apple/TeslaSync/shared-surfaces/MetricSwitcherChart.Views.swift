//
//  MetricSwitcherChart.Views.swift
//  TeslaSync — P4 shared surface · 0072 · MetricSwitcherChart (Apple)
//
//  The presentational subviews composed by `MetricSwitcherChart`: the titled panel chrome, the pill
//  switcher row (the native parity of the web `PillFilterBar`), the Swift Charts canvas (the parity of
//  the web Recharts bar / area / line switch, with a categorical date axis, token-styled grid + axis
//  labels, and a drag-to-inspect tooltip), and the loading / empty / error / freshness chrome. Each
//  consumes the P1/S10 facade (rendered verbatim) and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex. The views are pure functions of the resolved state, so every branch is
//  exercised by the previews and the projection is asserted in the tests.
//

import Charts
import SwiftUI

// MARK: - Panel (web `ChartContainer` + the switched chart body)

/// The full surface — the titled panel hosting the pill switcher and freshness chip in its header and
/// the state-driven chart body. The native parity of the web `<ChartContainer>` wrapping the metric
/// switcher, extended with the P4 loading / error / freshness chrome.
struct MetricSwitcherChartPanel: View {
    let resolved: MetricSwitcherResolved
    let canRetry: Bool
    let onSelect: (String) -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            chartBody
        }
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
    }

    // MARK: Header (web title bar — title + pills in the action area)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: resolved.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if let freshness = resolved.freshness {
                    MetricSwitcherFreshnessChip(
                        freshness: freshness,
                        onRefresh: canRetry ? onRetry : nil
                    )
                }
                Spacer(minLength: 0)
            }
            if !resolved.pills.isEmpty {
                MetricSwitcherPillBar(
                    pills: resolved.pills,
                    activeID: resolved.activeID,
                    onSelect: onSelect
                )
            }
        }
    }

    // MARK: Body (web `projected.length === 0 ? EmptyState : Chart` + P4 chrome)

    @ViewBuilder
    private var chartBody: some View {
        switch resolved.body {
        case .loading:
            MetricSwitcherChartLoadingView(height: resolved.height)
        case let .error(message, retryable):
            MetricSwitcherChartErrorView(
                message: message,
                showRetry: retryable && canRetry,
                onRetry: onRetry
            )
            .frame(minHeight: resolved.height)
        case let .empty(message):
            MetricSwitcherChartEmptyView(message: message)
                .frame(minHeight: resolved.height)
        case let .chart(metric):
            MetricSwitcherChartCanvas(metric: metric, height: resolved.height)
        }
    }
}

// MARK: - Pill switcher (web `PillFilterBar`)

/// The single-select metric switcher — the native parity of the web `PillFilterBar`. Mirrors the
/// shared `TSPillFilterBar`'s capsule styling, accent-selected fill, horizontal scroll, and
/// `.isSelected` trait, while rendering the per-surface facade-resolved labels verbatim. A
/// non-matching `activeID` highlights nothing (web: a pill key that matches no item).
struct MetricSwitcherPillBar: View {
    let pills: [MetricSwitcherPill]
    let activeID: String
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                ForEach(pills) { pill in
                    let isSelected = pill.id == activeID
                    Button {
                        onSelect(pill.id)
                    } label: {
                        Text(verbatim: pill.label)
                            .font(Font.TS.caption)
                            .fontWeight(isSelected ? .semibold : .regular)
                            .padding(.horizontal, TSSpacing.md)
                            .padding(.vertical, TSSpacing.xs)
                            .background(
                                isSelected ? Color.TS.accent : Color.TS.surface,
                                in: Capsule()
                            )
                            .foregroundStyle(isSelected ? Color.white : Color.TS.textSecondary)
                            .overlay(
                                Capsule().strokeBorder(Color.TS.border, lineWidth: isSelected ? 0 : 1)
                            )
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: pill.label))
                    .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (P4 connectivity axis: stale / offline)

/// The freshness chip shown beside the title when the snapshot is not live — a coloured dot + label
/// that re-requests the data on tap (when a retry handler is wired). Warning tone for stale, muted
/// tone for offline.
struct MetricSwitcherFreshnessChip: View {
    let freshness: MetricSwitcherFreshness
    let onRefresh: (() -> Void)?

    private var tone: Color {
        freshness.isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        Group {
            if let onRefresh {
                Button(action: onRefresh) { chip }
                    .buttonStyle(.plain)
            } else {
                chip
            }
        }
        .accessibilityLabel(Text(verbatim: freshness.accessibilityLabel))
    }

    private var chip: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: freshness.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
        .contentShape(Capsule())
    }
}

// MARK: - Chart canvas (web Recharts BarChart / AreaChart / LineChart → Swift Charts)

/// The chart itself — the native parity of the web `chartType` switch over Recharts `BarChart` /
/// `AreaChart` / `LineChart`. Composes Swift Charts directly (as the web composes Recharts directly),
/// over a categorical date X-axis with token-styled grid + axis labels, the metric's tick formatter on
/// the Y-axis, and a drag-to-inspect tooltip (the HIG-native parity of the web hover `<Tooltip>`).
struct MetricSwitcherChartCanvas: View {
    let metric: MetricSwitcherPlottedMetric
    let height: Double

    @State private var selectedDate: String?

    private var color: Color {
        TSChartPalette.color(at: metric.colorIndex)
    }

    private var selectedPoint: MetricSwitcherPoint? {
        guard let selectedDate else { return nil }
        return metric.points.first { $0.dateLabel == selectedDate }
    }

    var body: some View {
        chart
            .chartXSelection(value: $selectedDate)
            .chartXAxis {
                AxisMarks(values: metric.axisDateLabels) { value in
                    AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                    AxisValueLabel {
                        if let label = value.as(String.self) {
                            Text(verbatim: label)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(verbatim: metric.tickFormat.format(number))
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                        }
                    }
                }
            }
            .frame(height: height)
            .accessibilityLabel(Text(verbatim: metric.labelText))
            .accessibilityValue(Text(verbatim: metric.accessibilitySummary))
    }

    private var chart: some View {
        Chart {
            ForEach(metric.points) { point in
                marks(for: point)
            }
            if let selectedPoint {
                RuleMark(x: .value("date", selectedPoint.dateLabel))
                    .foregroundStyle(Color.TS.border)
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    .annotation(position: .top, alignment: .center, spacing: TSSpacing.xs) {
                        tooltip(for: selectedPoint)
                    }
            }
        }
    }

    @ChartContentBuilder
    private func marks(for point: MetricSwitcherPoint) -> some ChartContent {
        switch metric.kind {
        case .bar:
            BarMark(
                x: .value("date", point.dateLabel),
                y: .value("value", point.value)
            )
            .foregroundStyle(color.opacity(0.65))
            .cornerRadius(TSRadius.sm)
        case .area:
            AreaMark(
                x: .value("date", point.dateLabel),
                y: .value("value", point.value)
            )
            .foregroundStyle(TSChartGradient.fill(colorIndex: metric.colorIndex))
            .interpolationMethod(.catmullRom)
            LineMark(
                x: .value("date", point.dateLabel),
                y: .value("value", point.value)
            )
            .foregroundStyle(color)
            .interpolationMethod(.catmullRom)
        case .line:
            LineMark(
                x: .value("date", point.dateLabel),
                y: .value("value", point.value)
            )
            .foregroundStyle(color)
            .lineStyle(StrokeStyle(lineWidth: 2))
            .interpolationMethod(.catmullRom)
        }
    }

    private func tooltip(for point: MetricSwitcherPoint) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: point.dateLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: metric.tooltipValue(point))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityHidden(true)
    }
}

// MARK: - Empty (web `<EmptyState>` — never a blank box)

/// The friendly empty state shown when the active series has no points — the native parity of the web
/// `<EmptyState message={emptyMessage} />`. The pill row stays visible (in the panel header) so the
/// viewer can switch to a metric that has data.
struct MetricSwitcherChartEmptyView: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: MetricSwitcherChartStrings.string("metricSwitcher.empty.title", "No data"))
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            Text(verbatim: message)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Loading (P4 leaf: parent fetch → skeleton)

/// The skeleton chrome shown while the dataset resolves (web parent fetch) — a title shimmer over a
/// chart-area shimmer that mirrors the populated layout. Shimmer respects Reduce Motion via the shared
/// `TSSkeleton`.
struct MetricSwitcherChartLoadingView: View {
    let height: Double

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 12)
            TSSkeleton(height: height, cornerRadius: TSRadius.md)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MetricSwitcherChartStrings.string(
            "metricSwitcher.loadingA11y",
            "Loading chart data"
        )))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the load fails with no cached value — an inline error with an
/// optional retry affordance (the native peer of the web `QueryError`). Never a blank box (P4).
struct MetricSwitcherChartErrorView: View {
    let message: String
    let showRetry: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            if showRetry {
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: MetricSwitcherChartStrings.string("metricSwitcher.error.retry", "Retry"))
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}
