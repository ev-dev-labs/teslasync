//
//  ElevationProfile.Views.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The presentational subviews composed by `ElevationProfile`: the titled panel chrome (web
//  `ChartContainer` — title + `elevGain` subtitle + freshness chip), the Swift Charts canvas (the
//  native parity of the web Recharts `AreaChart` — a filled elevation area + crisp stroke over a
//  continuous distance axis, with the controlled cursor reference line, a drag-to-inspect tooltip, and
//  token-styled grid + axis labels), and the loading / empty / error chrome. Each consumes the P1/S10
//  facade (rendered verbatim) and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw
//  hex. The views are pure functions of the resolved state, so every branch is exercised by the
//  previews and the projection is asserted in the tests.
//

import Charts
import SwiftUI

// MARK: - Panel (web `ChartContainer` + the area chart body)

/// The full surface — the titled panel hosting the `elevGain` subtitle + freshness chip in its header
/// and the state-driven chart body. The native parity of the web `<ChartContainer title subtitle
/// ariaLabel>` wrapping the area chart, extended with the P4 loading / error / freshness chrome.
struct ElevationProfilePanel: View {
    let resolved: ElevationProfileResolved
    let canRetry: Bool
    let locale: Locale
    let onSelectDistance: (Double) -> Void
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

    // MARK: Header (web title bar — title + `↑ …m ↓ …m` subtitle + freshness)

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: resolved.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle = resolved.subtitle {
                    Text(verbatim: subtitle)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .monospacedDigit()
                        .accessibilityLabel(Text(verbatim: resolved.subtitleAccessibilityLabel ?? subtitle))
                }
            }
            Spacer(minLength: 0)
            if let freshness = resolved.freshness {
                ElevationProfileFreshnessChip(
                    freshness: freshness,
                    onRefresh: canRetry ? onRetry : nil
                )
            }
        }
    }

    // MARK: Body (web `data.length === 0 ? EmptyState : AreaChart` + P4 chrome)

    @ViewBuilder
    private var chartBody: some View {
        switch resolved.body {
        case .loading:
            ElevationProfileLoadingView(height: resolved.height)
        case let .error(message, retryable):
            ElevationProfileErrorView(
                message: message,
                showRetry: retryable && canRetry,
                onRetry: onRetry
            )
            .frame(minHeight: resolved.height)
        case let .empty(message):
            ElevationProfileEmptyView(message: message)
                .frame(minHeight: resolved.height)
        case let .chart(plotted):
            ElevationProfileChartCanvas(
                plotted: plotted,
                height: resolved.height,
                locale: locale,
                onSelectDistance: onSelectDistance
            )
        }
    }
}

// MARK: - Chart canvas (web Recharts `AreaChart` → Swift Charts)

/// The area chart itself — the native parity of the web Recharts `AreaChart`. A filled elevation area
/// (monotone, the web `AREA_DEFAULTS.type = 'monotone'`) with a crisp top stroke over a continuous
/// distance X-axis, the controlled cursor reference line (web `ReferenceLine x={cursorDistance}`), a
/// drag-to-inspect tooltip (the HIG-native parity of the web hover `<Tooltip>`), and token-styled grid
/// + axis labels (the web `chartGrid` / `axisTick` + the `distanceUnit` / `m` axis titles).
struct ElevationProfileChartCanvas: View {
    let plotted: ElevationProfilePlotted
    let height: Double
    let locale: Locale
    let onSelectDistance: (Double) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var rawSelection: Double?
    @State private var lastSelectedPosition: Int?

    private var selectedSample: ElevationProfileSample? {
        guard
            let rawSelection,
            let position = ElevationProfileLogic.nearestArrayPosition(plotted.samples, toDistance: rawSelection)
        else { return nil }
        return plotted.samples[position]
    }

    var body: some View {
        chart
            .chartYScale(domain: plotted.elevationDomain)
            .chartYAxis { yAxisMarks }
            .chartXAxis { xAxisMarks }
            .chartXAxisLabel(alignment: .trailing) {
                Text(verbatim: plotted.distanceUnit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .chartYAxisLabel(position: .leading) {
                Text(verbatim: plotted.metresUnit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .chartXSelection(value: $rawSelection)
            .onChange(of: rawSelection) { _, newValue in
                reportSelection(newValue)
            }
            .chartLegend(.hidden)
            .frame(height: height)
            .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: plotted)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: plotted.seriesLabel))
            .accessibilityValue(Text(verbatim: plotted.accessibilitySummary))
    }

    private var chart: some View {
        Chart {
            ForEach(plotted.samples) { sample in
                AreaMark(
                    x: .value(distanceAxisLabel, sample.distance),
                    y: .value(elevationAxisLabel, sample.elevation)
                )
                .foregroundStyle(areaGradient)
                .interpolationMethod(.monotone)
                .accessibilityHidden(true)

                LineMark(
                    x: .value(distanceAxisLabel, sample.distance),
                    y: .value(elevationAxisLabel, sample.elevation)
                )
                .foregroundStyle(Color.TS.statusSuccess)
                .lineStyle(StrokeStyle(lineWidth: 2))
                .interpolationMethod(.monotone)
                .accessibilityHidden(true)
            }

            if let cursorDistance = plotted.cursorDistance {
                RuleMark(x: .value(distanceAxisLabel, cursorDistance))
                    .foregroundStyle(Color.TS.accent)
                    .lineStyle(StrokeStyle(lineWidth: 2, dash: [4, 2]))
                    .accessibilityHidden(true)
            }

            if let selectedSample {
                RuleMark(x: .value(distanceAxisLabel, selectedSample.distance))
                    .foregroundStyle(Color.TS.textMuted.opacity(0.6))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        ElevationProfileTooltip(plotted: plotted, sample: selectedSample, locale: locale)
                    }
            }
        }
    }

    /// Fires the host callback once per distinct sample (web `onClickIndex`), deduping the continuous
    /// `chartXSelection` stream so a drag across one sample reports a single selection.
    private func reportSelection(_ distance: Double?) {
        guard
            let distance,
            let position = ElevationProfileLogic.nearestArrayPosition(plotted.samples, toDistance: distance),
            position != lastSelectedPosition
        else {
            if distance == nil { lastSelectedPosition = nil }
            return
        }
        lastSelectedPosition = position
        onSelectDistance(distance)
    }

    // MARK: Axes (web `chartGrid` + `axisTick` + tick formatters)

    @AxisContentBuilder
    private var yAxisMarks: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: plotted.elevationTickLabel(number, locale: locale))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var xAxisMarks: some AxisContent {
        AxisMarks(values: plotted.axisDistanceValues) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.25))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: plotted.distanceTickLabel(number, locale: locale))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    // MARK: Style helpers

    /// The area fill — the web `areaGradient('elevGrad', '#10b981', 0.4)` (top 0.4 → bottom 0.02),
    /// derived from the success token (#10b981) so it tracks light / dark / high-contrast themes.
    private var areaGradient: LinearGradient {
        LinearGradient(
            colors: [Color.TS.statusSuccess.opacity(0.4), Color.TS.statusSuccess.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var distanceAxisLabel: String {
        plotted.distanceUnit
    }

    private var elevationAxisLabel: String {
        plotted.seriesLabel
    }
}

// MARK: - Tooltip (web `<Tooltip>`)

/// The selection tooltip — the sample's distance header over its elevation value, the native parity of
/// the web `<Tooltip labelFormatter formatter>` payload (`"${fmt(d, 2)} ${unit}"` + `"Elevation:
/// ${fmt(e, 0)} m"`).
struct ElevationProfileTooltip: View {
    let plotted: ElevationProfilePlotted
    let sample: ElevationProfileSample
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: plotted.distanceLabel(for: sample, locale: locale))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(Color.TS.statusSuccess)
                    .frame(width: 7, height: 7)
                Text(verbatim: plotted.seriesLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: plotted.elevationValue(for: sample, locale: locale))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
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
        .frame(minWidth: 140, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
