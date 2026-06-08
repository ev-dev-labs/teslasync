//
//  BatteryLevelChart.Views.swift
//  TeslaSync — P4 feature view · 0097 · BatteryLevelChart (Apple)
//
//  Presentational chrome composed by `BatteryLevelChart`: the panel header + hint
//  + freshness chip, the stale/offline connectivity banner, the Swift Charts bar
//  chart (web Recharts `BarChart` → native `Chart { BarMark }`) with its selection
//  tooltip (web `ChartTooltip`), and the loading / empty / error states. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Header (title + hint + freshness chip)

/// The panel header: the web `<h3>` with the lucide `BatteryCharging` glyph + the
/// "Battery Level at Charge Start" title + the muted hint, plus the live-state
/// freshness chip. The web renders the hint inline; native lifts it to a caption
/// line so it stays legible at Dynamic Type sizes.
struct BatteryLevelHeader: View {
    let connection: BatteryLevelConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "bolt.batteryblock.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesEnergy)
                    .accessibilityHidden(true)
                BatteryLevelStrings.text("charging.charts.batteryLevelAtStart", "Battery Level at Charge Start")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                BatteryLevelFreshnessChip(connection: connection)
            }
            BatteryLevelStrings.text(
                "charging.charts.batteryLevelHint",
                "How low do you typically go before charging?"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct BatteryLevelFreshnessChip: View {
    let connection: BatteryLevelConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            BatteryLevelStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(BatteryLevelStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: BatteryLevelConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.charts.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.charts.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.charts.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so cached bars are clearly labeled (web `DataFreshness` intent).
struct BatteryLevelConnectivityBanner: View {
    let connection: BatteryLevelConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.charts.offlineBanner" : "charging.charts.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded charge history"
            : "Reconnecting — charge history may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            BatteryLevelStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Chart (web Recharts `BarChart`)

/// The start-of-charge histogram — the native counterpart of the web Recharts
/// `BarChart` with one amber `<Bar dataKey="count">`. One column per decile;
/// tapping a column reveals a value tooltip (web `ChartTooltip`); each column
/// carries a per-bucket VoiceOver value.
struct BatteryLevelBarChart: View {
    let buckets: [BatteryStartLevelBucket]

    @State private var selectedRange: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web amber bar fill (`#f59e0b` at `fillOpacity={0.6}`) → the energy series
    /// token at the same opacity, so light / dark / high-contrast all resolve.
    private static let barColor = Color.TS.chartSeriesEnergy

    private var selectedBucket: BatteryStartLevelBucket? {
        guard let selectedRange else { return nil }
        return buckets.first { $0.range == selectedRange }
    }

    private var rangeAxisName: String {
        BatteryLevelStrings.string("charging.charts.batteryLevel.range", "Start Level")
    }

    private var countAxisName: String {
        BatteryLevelStrings.string("charging.charts.batteryLevelSessions", "Sessions")
    }

    var body: some View {
        Chart {
            ForEach(buckets) { bucket in
                BarMark(
                    x: .value(rangeAxisName, bucket.range),
                    y: .value(countAxisName, bucket.count)
                )
                .foregroundStyle(Self.barColor.opacity(0.6))
                .cornerRadius(4)
                .accessibilityLabel(Text(verbatim: bucket.range))
                .accessibilityValue(Text(verbatim: barValue(for: bucket)))
            }
            selectionRule
        }
        .chartXScale(domain: buckets.map(\.range))
        .chartXSelection(value: $selectedRange)
        .chartLegend(.hidden)
        .chartXAxis { xAxis }
        .chartYAxis { yAxis }
        .frame(height: 176)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: buckets)
        .accessibilityLabel(
            BatteryLevelStrings.text(
                "charging.charts.batteryLevel.a11y",
                "Bar chart of how many charge sessions started in each ten percent battery-level range"
            )
        )
    }

    @ChartContentBuilder
    private var selectionRule: some ChartContent {
        if let selectedBucket {
            RuleMark(x: .value(rangeAxisName, selectedBucket.range))
                .foregroundStyle(Color.TS.border)
                .annotation(
                    position: .top,
                    overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                ) {
                    BatteryLevelTooltip(bucket: selectedBucket)
                }
        }
    }

    @AxisContentBuilder
    private var xAxis: some AxisContent {
        AxisMarks { value in
            AxisValueLabel {
                if let label = value.as(String.self) {
                    Text(verbatim: label)
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    @AxisContentBuilder
    private var yAxis: some AxisContent {
        AxisMarks(position: .leading) { value in
            AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
            AxisValueLabel {
                if let number = value.as(Int.self) {
                    Text(verbatim: "\(number)")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }

    private func barValue(for bucket: BatteryStartLevelBucket) -> String {
        BatteryLevelAccessibility.barValue(bucket, localize: BatteryLevelStrings.string)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the decile label over its session count — the native
/// parity of the web `ChartTooltip` payload (`Sessions: N`).
struct BatteryLevelTooltip: View {
    let bucket: BatteryStartLevelBucket

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: bucket.range)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            HStack(spacing: TSSpacing.sm) {
                Circle().fill(Color.TS.chartSeriesEnergy).frame(width: 7, height: 7)
                BatteryLevelStrings.text("charging.charts.batteryLevelSessions", "Sessions")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.md)
                Text(verbatim: "\(bucket.count)")
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

/// The initial-fetch skeleton chrome: a row of muted bars under a faint baseline,
/// respecting Reduce Motion (via `TSSkeleton`).
struct BatteryLevelLoadingChart: View {
    private let heights: [CGFloat] = [40, 76, 120, 150, 132, 96, 70, 54, 36, 24]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 14, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 176, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(BatteryLevelStrings.text("charging.charts.batteryLevel.loading", "Loading charge history"))
    }
}

// MARK: - Empty state (web `EmptyState` — "No data available")

/// The resolved-but-empty state: the web `<EmptyState>` over a native
/// `ContentUnavailableView` with the battery glyph. Never a blank box.
struct BatteryLevelEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                BatteryLevelStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "bolt.batteryblock")
            }
        } description: {
            BatteryLevelStrings.text(
                "charging.charts.batteryLevel.emptyHint",
                "Start-level distribution will appear here once charge sessions are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 176)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct BatteryLevelError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            BatteryLevelStrings.text("charging.charts.batteryLevel.errorTitle", "Couldn't load charge history")
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
                BatteryLevelStrings.text("charging.charts.batteryLevel.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(BatteryLevelStrings.text("charging.charts.batteryLevel.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 176)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
