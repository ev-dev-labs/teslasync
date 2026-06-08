//
//  SocChart.Views.swift
//  TeslaSync — P4 feature view · 0148 · SocChart (Apple)
//
//  Presentational chrome composed by `SocChart`: the panel header + freshness
//  chip, the stale/offline banner, the Swift Charts state-of-charge area chart
//  (web Recharts `AreaChart` → native `Chart { AreaMark + LineMark }`) with its
//  synced-cursor reference line + selection tooltip (web `ReferenceLine` +
//  `ChartTooltip`), and the loading / empty / error states. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and
//  no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `SOC % Over Time` with a
/// battery glyph + the live-state freshness chip.
struct SocChartHeader: View {
    let connection: SocChartConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "battery.100")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesBattery)
                .accessibilityHidden(true)
            SocChartStrings.text("driveDetail.socOverTime", "SOC % Over Time")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            SocChartFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SocChartFreshnessChip: View {
    let connection: SocChartConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SocChartStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SocChartStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SocChartConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.soc.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.soc.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.soc.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so a cached trace is clearly labeled (web `DataFreshness` intent).
struct SocChartConnectivityBanner: View {
    let connection: SocChartConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.soc.offlineBanner" : "driveDetail.soc.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded state of charge"
            : "Reconnecting — state of charge may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SocChartStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Chart (web Recharts `AreaChart`)

/// The state-of-charge area chart — the native counterpart of the web Recharts
/// `AreaChart` with one green `<Area dataKey="battery">` over a `[0, 100]` Y axis.
/// A filled `AreaMark` gradient (web `url(#socGrad)`) sits under a 2pt `LineMark`
/// stroke (web `stroke="#10b981"`); the x axis shows only the first + last time
/// labels (web `interval="preserveStartEnd"`); tapping the plot drops the synced
/// reference line + a value tooltip (web `ReferenceLine` + `ChartTooltip`).
struct SocChartAreaChart: View {
    let samples: [SocSample]
    @Binding var selectedTime: String?
    let locale: Locale

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web SOC green (`#10b981`) → the battery series token (the exact same
    /// sRGB), so light / dark / high-contrast all resolve.
    private static let socColor = Color.TS.chartSeriesBattery

    private var timeAxisName: String {
        SocChartStrings.string("driveDetail.soc.timeAxis", "Time")
    }

    private var socAxisName: String {
        SocChartStrings.string("driveDetail.soc", "SOC")
    }

    /// The currently selected sample (web synced `activeLabel` → datum).
    private var selectedSample: SocSample? {
        SocChartProjection.sample(
            at: SocChartProjection.index(forTime: selectedTime, in: samples),
            in: samples
        )
    }

    /// Bridges the chart's numeric x selection to the shared time-label cursor the
    /// model owns (web `useSyncedCursor` keys the shared cursor by the x label).
    private var selectionBinding: Binding<Int?> {
        Binding(
            get: { SocChartProjection.index(forTime: selectedTime, in: samples) },
            set: { newIndex in selectedTime = SocChartProjection.sample(at: newIndex, in: samples)?.time }
        )
    }

    private var xDomain: ClosedRange<Int> {
        0 ... max(samples.count - 1, 0)
    }

    /// The two time labels Recharts keeps with `interval="preserveStartEnd"`.
    private var edgeIndices: [Int] {
        guard let last = samples.last else { return [] }
        return samples.count > 1 ? [0, last.index] : [last.index]
    }

    private var areaGradient: LinearGradient {
        LinearGradient(
            gradient: Gradient(colors: [Self.socColor.opacity(0.35), Self.socColor.opacity(0.02)]),
            startPoint: .top,
            endPoint: .bottom
        )
    }

    var body: some View {
        Chart {
            ForEach(samples) { sample in
                AreaMark(
                    x: .value(timeAxisName, sample.index),
                    y: .value(socAxisName, sample.battery)
                )
                .foregroundStyle(areaGradient)
                .interpolationMethod(.monotone)
            }
            ForEach(samples) { sample in
                LineMark(
                    x: .value(timeAxisName, sample.index),
                    y: .value(socAxisName, sample.battery)
                )
                .foregroundStyle(Self.socColor)
                .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                .interpolationMethod(.monotone)
            }
            cursorRule
        }
        .chartYScale(domain: SocChartProjection.socDomain)
        .chartXScale(domain: xDomain)
        .chartXSelection(value: selectionBinding)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 220)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: samples)
        .accessibilityElement()
        .accessibilityLabel(
            SocChartStrings.text(
                "driveDetail.socOverTime.aria",
                "State of charge percent over time area chart"
            )
        )
        .accessibilityValue(
            Text(verbatim: SocChartAccessibility.chartSummary(
                samples: samples,
                localize: SocChartStrings.string,
                locale: locale
            ))
        )
    }

    /// The synced-cursor reference line (web `<ReferenceLine x={syncedX}>`) plus its
    /// selection tooltip.
    @ChartContentBuilder
    private var cursorRule: some ChartContent {
        if let selectedSample {
            RuleMark(x: .value(timeAxisName, selectedSample.index))
                .foregroundStyle(Color.TS.border)
                .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    SocChartTooltip(sample: selectedSample, locale: locale)
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks(values: edgeIndices) { value in
            AxisValueLabel {
                if let index = value.as(Int.self) {
                    Text(verbatim: label(forIndex: index))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading, values: [0, 25, 50, 75, 100]) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Double.self) {
                    Text(verbatim: SocChartFormat.percent(number, locale: locale))
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func label(forIndex index: Int) -> String {
        samples.first { $0.index == index }?.time ?? ""
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the sample's time label over its SOC percent — the
/// native parity of the web `ChartTooltip` payload (`SOC %: N`).
struct SocChartTooltip: View {
    let sample: SocSample
    let locale: Locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: sample.time)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(Color.TS.chartSeriesBattery).frame(width: 7, height: 7)
                SocChartStrings.text("driveDetail.soc", "SOC")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: SocChartFormat.percent(sample.battery, locale: locale))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 132, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint baseline under a muted chart block,
/// respecting Reduce Motion (via `TSSkeleton`).
struct SocChartLoadingChart: View {
    private let dots = 6

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< dots, id: \.self) { _ in
                    TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                }
                Spacer(minLength: 0)
            }
            TSSkeleton(height: 168, cornerRadius: TSRadius.md)
        }
        .frame(height: 220, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SocChartStrings.text("driveDetail.soc.loading", "Loading state of charge"))
    }
}

// MARK: - Empty state (web `Activity` overlay — "No telemetry data available")

/// The resolved-but-empty state: the web `Activity`-glyph overlay
/// ("No telemetry data available") over a native `ContentUnavailableView`. Never a
/// blank box.
struct SocChartEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SocChartStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            SocChartStrings.text(
                "driveDetail.soc.emptyHint",
                "The state-of-charge trace appears here once this drive has telemetry samples."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SocChartError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SocChartStrings.text("driveDetail.soc.errorTitle", "Couldn't load state of charge")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                SocChartStrings.text("driveDetail.soc.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SocChartStrings.text("driveDetail.soc.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
