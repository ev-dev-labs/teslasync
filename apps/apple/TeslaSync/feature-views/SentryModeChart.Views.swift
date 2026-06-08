//
//  SentryModeChart.Views.swift
//  TeslaSync — P4 feature view · 0047 · SentryModeChart (Apple)
//
//  Presentational chrome composed by `SentryModeChart`: the panel header + freshness
//  chip, the stale/offline connectivity banner, the stacked Swift Charts bar chart
//  (web Recharts `BarChart` → native `Chart { BarMark }`) with its selection tooltip
//  (web `ChartTooltip`) and legend, and the loading / empty / error states. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here.
//

import Charts
import SwiftUI

// MARK: - Series palette (web fill #3b82f6 / #6b7280 → adaptive tokens)

/// The series → fill mapping. The web uses a static blue for armed and a static
/// gray for off; native uses the adaptive semantic tokens (info accent for the
/// active series, muted for the inactive one) so light / dark / high-contrast all
/// resolve correctly.
enum SentryModePalette {
    static func color(for series: SentrySeries) -> Color {
        switch series {
        case .on: Color.TS.statusInfo
        case .off: Color.TS.textMuted
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `<h2>Sentry Mode Activity</h2>` with an `Activity`
/// glyph (web lucide `Activity`) and the live-state freshness chip.
struct SentryModeHeader: View {
    let connection: SentryModeConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusInfo)
                .accessibilityHidden(true)
            SentryModeStrings.text("admin.security.sentryChart", "Sentry Mode Activity")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            SentryModeFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SentryModeFreshnessChip: View {
    let connection: SentryModeConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SentryModeStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SentryModeStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SentryModeConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "admin.security.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "admin.security.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "admin.security.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so cached columns are clearly labeled (web `DataFreshness` intent).
struct SentryModeConnectivityBanner: View {
    let connection: SentryModeConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.security.offlineBanner" : "admin.security.staleBanner"
        let fallback = offline
            ? "Offline — showing last known sentry activity"
            : "Reconnecting — sentry activity may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SentryModeStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web Recharts `Legend`)

/// The two-series legend (web `<Legend>`): a colored swatch + the series name for
/// each of Sentry On / Sentry Off.
struct SentryModeLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(SentrySeries.allCases.sorted { $0.order < $1.order }) { series in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(SentryModePalette.color(for: series))
                        .frame(width: 10, height: 10)
                    SentryModeStrings.text(series.localizationKey, series.fallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Chart (web Recharts stacked `BarChart`)

/// The stacked bar chart — the native counterpart of the web Recharts `BarChart`
/// with two `<Bar stackId="sentry">` series. One stacked column per day; tapping a
/// column reveals a value tooltip (web `ChartTooltip`); each column carries a
/// per-day VoiceOver value.
struct SentryModeBarChart: View {
    let points: [SentryDayPoint]
    let rows: [SentryChartRow]

    @State private var selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var selectedPoint: SentryDayPoint? {
        guard let selectedKey else { return nil }
        return points.first { $0.dateKey == selectedKey }
    }

    private var seriesLabel: String {
        SentryModeStrings.string("admin.security.chart.series", "Series")
    }

    private var dayLabel: String {
        SentryModeStrings.string("admin.security.chart.day", "Day")
    }

    private var countLabel: String {
        SentryModeStrings.string("admin.security.chart.count", "Events")
    }

    var body: some View {
        Chart {
            ForEach(rows) { row in
                BarMark(
                    x: .value(dayLabel, row.dateKey),
                    y: .value(countLabel, row.count)
                )
                .foregroundStyle(by: .value(seriesLabel, localizedName(row.series)))
                .cornerRadius(3)
                .accessibilityLabel(Text(verbatim: row.label))
                .accessibilityValue(Text(verbatim: columnValue(for: row.dateKey)))
            }

            if let selectedPoint {
                RuleMark(x: .value(dayLabel, selectedPoint.dateKey))
                    .foregroundStyle(Color.TS.border)
                    .annotation(
                        position: .top,
                        overflowResolution: .init(x: .fit(to: .chart), y: .disabled)
                    ) {
                        SentryModeTooltip(point: selectedPoint)
                    }
            }
        }
        .chartForegroundStyleScale(domain: seriesDomain, range: seriesRange)
        .chartXScale(domain: points.map(\.dateKey))
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
                    if let number = value.as(Int.self) {
                        Text(verbatim: "\(number)")
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .frame(height: 240)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: rows)
        .accessibilityLabel(
            SentryModeStrings.text(
                "admin.security.chart.a11y",
                "Stacked bar chart of daily sentry-armed and sentry-off event counts"
            )
        )
    }

    private var seriesDomain: [String] {
        SentrySeries.allCases.sorted { $0.order < $1.order }.map(localizedName)
    }

    private var seriesRange: [Color] {
        SentrySeries.allCases.sorted { $0.order < $1.order }.map(SentryModePalette.color)
    }

    private func localizedName(_ series: SentrySeries) -> String {
        SentryModeStrings.string(series.localizationKey, series.fallback)
    }

    private func labelForKey(_ key: String) -> String {
        points.first { $0.dateKey == key }?.label ?? key
    }

    private func columnValue(for key: String) -> String {
        guard let point = points.first(where: { $0.dateKey == key }) else { return "" }
        return SentryModeAccessibility.columnLabel(point, localize: SentryModeStrings.string)
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// The selection tooltip: the day label over both series' counts, the native
/// parity of the web `ChartTooltip` payload list.
struct SentryModeTooltip: View {
    let point: SentryDayPoint

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: point.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(SentrySeries.allCases.sorted { $0.order < $1.order }) { series in
                HStack(spacing: TSSpacing.sm) {
                    Circle().fill(SentryModePalette.color(for: series)).frame(width: 7, height: 7)
                    SentryModeStrings.text(series.localizationKey, series.fallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: "\(point.count(for: series))")
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
        .frame(minWidth: 132, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of muted bars under a faint baseline,
/// respecting Reduce Motion (via `TSSkeleton`).
struct SentryModeLoadingChart: View {
    private let heights: [CGFloat] = [120, 168, 96, 200, 140, 176, 110]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 18, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 240, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(SentryModeStrings.text("admin.security.chart.loading", "Loading sentry activity"))
    }
}

// MARK: - Empty state (web `EmptyState` — "No data available")

/// The resolved-but-empty state: the web `<EmptyState message={t('common.noData')}>`
/// over a native `ContentUnavailableView` with the `Activity` glyph. Never a blank
/// box.
struct SentryModeEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SentryModeStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            SentryModeStrings.text(
                "admin.security.chart.emptyHint",
                "Sentry activity will appear here once security events are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SentryModeError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SentryModeStrings.text("admin.security.chart.errorTitle", "Couldn't load sentry activity")
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
                SentryModeStrings.text("admin.security.chart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SentryModeStrings.text("admin.security.chart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
