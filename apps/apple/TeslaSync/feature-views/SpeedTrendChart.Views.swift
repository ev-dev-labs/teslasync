//
//  SpeedTrendChart.Views.swift
//  TeslaSync — P4 feature view · 0092 · SpeedTrendChart (Apple)
//
//  Presentational chrome composed by `SpeedTrendChart`: the panel header +
//  subtitle + freshness chip, the stale/offline banner, the two-series Swift
//  Charts line chart (web Recharts `LineChart` → native `Chart { LineMark }`) with
//  its selection tooltip + bottom legend (`DC Fast` / `AC / Home`), and the
//  loading / empty / error states. Copy resolves through the P1/S10 facade; chrome
//  is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Series palette (web line `stroke={palette[0/1]}`)

/// The series → stroke mapping. The web colors each line from the user's chart
/// palette (`palette[0]` DC, `palette[1]` AC); native reads the same index-stable
/// categorical tokens so a line and its legend swatch always agree.
enum SpeedTrendPalette {
    static func color(for series: SpeedSeries) -> Color {
        TSChartPalette.color(at: series.colorIndex)
    }
}

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title `Charging Speed Trend` with a
/// charge glyph + the live-state freshness chip, over the subtitle
/// `Monthly average DC vs AC charge rate`.
struct SpeedTrendHeader: View {
    let connection: SpeedTrendConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SpeedTrendStrings.text("charging.curve.speedTrend", "Charging Speed Trend")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                SpeedTrendFreshnessChip(connection: connection)
            }
            SpeedTrendStrings.text(
                "charging.curve.speedTrendDesc",
                "Monthly average DC vs AC charge rate"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SpeedTrendFreshnessChip: View {
    let connection: SpeedTrendConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SpeedTrendStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SpeedTrendStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SpeedTrendConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so a cached trend is clearly labeled (web `DataFreshness` intent).
struct SpeedTrendConnectivityBanner: View {
    let connection: SpeedTrendConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charge-speed trend"
            : "Reconnecting — charge-speed trend may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SpeedTrendStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web bottom swatches)

/// The two-series legend (web `DC Fast` / `AC / Home`): a colored swatch + the
/// legend label for each series, colored from the series palette.
struct SpeedTrendLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(SpeedSeries.allCases.sorted { $0.order < $1.order }) { series in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(SpeedTrendPalette.color(for: series))
                        .frame(width: 12, height: 8)
                    SpeedTrendStrings.text(series.legendKey, series.legendFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
    }
}

// MARK: - Chart (web Recharts two-series `LineChart`)

/// The two-series line chart — the native counterpart of the web Recharts
/// `LineChart` with `dcAvgKw` + `acAvgKw` lines. One point per (month, series);
/// tapping a month reveals a value tooltip (web `ChartTooltip`); each month
/// carries a per-month VoiceOver value, and the Y axis carries the web `Avg kW`
/// label.
struct SpeedTrendLineChart: View {
    let points: [MonthlySpeedPoint]
    let rows: [SpeedTrendRow]
    let locale: Locale

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedPoint: MonthlySpeedPoint? {
        guard let selectedKey else { return nil }
        return points.first { $0.monthKey == selectedKey }
    }

    private var monthLabel: String {
        SpeedTrendStrings.string("charging.curve.col.month", "Month")
    }

    private var avgKwLabel: String {
        SpeedTrendStrings.string("charging.curve.avgKw", "Avg kW")
    }

    var body: some View {
        Chart {
            ForEach(rows) { row in
                LineMark(
                    x: .value(monthLabel, row.monthKey),
                    y: .value(avgKwLabel, row.valueKw)
                )
                .foregroundStyle(by: .value(avgKwLabel, localizedName(row.series)))
                .symbol(by: .value(avgKwLabel, localizedName(row.series)))
                .symbolSize(56)
                .interpolationMethod(.catmullRom)
                .accessibilityLabel(Text(verbatim: row.label))
                .accessibilityValue(Text(verbatim: rowValue(for: row)))
            }

            if let selectedPoint {
                RuleMark(x: .value(monthLabel, selectedPoint.monthKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        SpeedTrendTooltip(point: selectedPoint, locale: locale)
                    }
            }
        }
        .chartForegroundStyleScale(domain: seriesDomain, range: seriesRange)
        .chartSymbolScale(domain: seriesDomain, range: [Circle(), Circle()])
        .chartXScale(domain: points.map(\.monthKey))
        .chartXSelection(value: $selectedKey)
        .chartLegend(.hidden)
        .chartXAxis {
            AxisMarks { value in
                AxisValueLabel {
                    if let key = value.as(String.self) {
                        Text(verbatim: labelForKey(key))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { value in
                AxisGridLine().foregroundStyle(Color.TS.border.opacity(0.4))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(verbatim: SpeedTrendFormat.decimal(number, locale: locale))
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .chartYAxisLabel(position: .leading, alignment: .center) {
            Text(verbatim: avgKwLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(height: 260)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: rows)
        .accessibilityLabel(
            SpeedTrendStrings.text(
                "charging.curve.speedTrend.aria",
                "Monthly average DC and AC charging speed line chart"
            )
        )
    }

    private var seriesDomain: [String] {
        SpeedSeries.allCases.sorted { $0.order < $1.order }.map(localizedName)
    }

    private var seriesRange: [Color] {
        SpeedSeries.allCases.sorted { $0.order < $1.order }.map(SpeedTrendPalette.color)
    }

    private func localizedName(_ series: SpeedSeries) -> String {
        SpeedTrendStrings.string(series.nameKey, series.nameFallback)
    }

    private func labelForKey(_ key: String) -> String {
        points.first { $0.monthKey == key }?.label ?? key
    }

    private func rowValue(for row: SpeedTrendRow) -> String {
        let unit = SpeedTrendStrings.string("charging.curve.kwUnit", "kW")
        let name = localizedName(row.series)
        let value = SpeedTrendFormat.kilowatts(row.valueKw, unit: unit, locale: locale)
        return "\(row.label): \(name) \(value)"
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the month label over both series' kW values, the native
/// parity of the web `ChartTooltip` payload list.
struct SpeedTrendTooltip: View {
    let point: MonthlySpeedPoint
    let locale: Locale

    private var unit: String {
        SpeedTrendStrings.string("charging.curve.kwUnit", "kW")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(SpeedSeries.allCases.sorted { $0.order < $1.order }) { series in
                HStack(spacing: TSSpacing.sm) {
                    Circle().fill(SpeedTrendPalette.color(for: series)).frame(width: 7, height: 7)
                    SpeedTrendStrings.text(series.nameKey, series.nameFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: SpeedTrendFormat.kilowatts(point.value(for: series), unit: unit, locale: locale))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                }
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(minWidth: 156, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint baseline with two muted trend lines
/// of dots, respecting Reduce Motion (via `TSSkeleton`).
struct SpeedTrendLoadingChart: View {
    private let columns = 6

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    ForEach(0 ..< columns, id: \.self) { _ in
                        TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                    }
                    Spacer(minLength: 0)
                }
            }
            TSSkeleton(height: 120, cornerRadius: TSRadius.md)
        }
        .frame(height: 260, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            SpeedTrendStrings.text("charging.curve.loading", "Loading charging speed trend")
        )
    }
}

// MARK: - Empty state (web `ChartContainer` empty overlay — "No data available")

/// The resolved-but-empty state: the web empty overlay over a native
/// `ContentUnavailableView` with a chart glyph. Never a blank box.
struct SpeedTrendEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SpeedTrendStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            SpeedTrendStrings.text(
                "charging.curve.emptyHint",
                "Charging speed trends will appear here once charging sessions are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SpeedTrendError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SpeedTrendStrings.text("charging.curve.errorTitle", "Couldn't load charging speed trend")
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
                SpeedTrendStrings.text("charging.curve.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SpeedTrendStrings.text("charging.curve.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
