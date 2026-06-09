//
//  SpeedHistogramChart.Views.swift
//  TeslaSync — P4 feature view · 0149 · SpeedHistogramChart (Apple)
//
//  Presentational chrome composed by `SpeedHistogramChart`: the bar palette, the
//  panel header + freshness chip, the stale/offline connectivity banner, the data
//  table (web `ChartContainer` dataColumns), and the loading / empty / error states.
//  The single-series Swift Charts bar chart + its tooltip live in
//  `SpeedHistogramChart.Chart.swift`. All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9). No networking and no Tailwind ports here.
//

import SwiftUI

// MARK: - Palette (web `<Bar fill="#a855f7">` → adaptive token)

/// The histogram bar fill. The web hardcodes `#a855f7`; the generated
/// `chartSeriesPower` token is the same hue (#A855F7) and is index-stable across
/// platforms, so light / dark / high-contrast all resolve correctly.
enum SpeedHistogramPalette {
    static let bar = Color.TS.chartSeriesPower
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title with a histogram glyph and the
/// live-state freshness chip.
struct SpeedHistogramHeader: View {
    let connection: SpeedHistogramConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(SpeedHistogramPalette.bar)
                .accessibilityHidden(true)
            SpeedHistogramStrings.text("driveDetail.speedHistogram", "Speed Histogram")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            SpeedHistogramFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SpeedHistogramFreshnessChip: View {
    let connection: SpeedHistogramConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SpeedHistogramStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SpeedHistogramStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SpeedHistogramConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so cached bars are clearly labeled (web `DataFreshness` intent).
struct SpeedHistogramConnectivityBanner: View {
    let connection: SpeedHistogramConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing the last recorded speed distribution"
            : "Reconnecting — speed distribution may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SpeedHistogramStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Data table (web `ChartContainer` dataColumns)

/// The accessible data table — the native parity of the web `ChartContainer`
/// `data` + `dataColumns` fallback (Speed range / % of drive), carrying the same
/// figures the chart encodes.
struct SpeedHistogramDataTable: View {
    let bars: [SpeedHistogramBar]
    @Environment(\.locale) private var locale

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.xs) {
            GridRow {
                headerCell("driveDetail.col.range", "Speed range", alignment: .leading)
                headerCell("driveDetail.col.pct", "% of drive", alignment: .trailing)
            }
            ForEach(bars) { bar in
                Divider().gridCellColumns(2).overlay(Color.TS.border)
                GridRow {
                    Text(verbatim: bar.range)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textPrimary)
                        .monospacedDigit()
                        .frame(maxWidth: .infinity, alignment: .leading)
                    valueCell(SpeedHistogramChartProjection.percentString(bar.pct, locale: locale))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }

    private func headerCell(_ key: String, _ fallback: String, alignment: HorizontalAlignment) -> some View {
        SpeedHistogramStrings.text(key, fallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .trailing)
    }

    private func valueCell(_ value: String) -> some View {
        Text(verbatim: value)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of muted histogram bars under a faint
/// baseline, respecting Reduce Motion (via `TSSkeleton`).
struct SpeedHistogramLoadingChart: View {
    private let heights: [CGFloat] = [60, 110, 170, 150, 96, 70, 48]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 26, height: height, cornerRadius: 4)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 220, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(
            SpeedHistogramStrings.text("driveDetail.speedHistogram.loading", "Loading speed distribution")
        )
    }
}

// MARK: - Empty state (web Activity glyph + "No telemetry data available")

/// The resolved-but-empty state: the web `speedHistData.length === 0` branch — the
/// Activity glyph over "No telemetry data available" — as a native
/// `ContentUnavailableView`. Never a blank box.
struct SpeedHistogramEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SpeedHistogramStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            SpeedHistogramStrings.text(
                "driveDetail.speedHistogram.emptyHint",
                "The speed distribution will appear here once this drive has telemetry samples."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` / section error boundary)

/// The fetch-failure state with a retry affordance — the native parity of the web
/// drive-detail section error boundary (`driveDetail.section.speedHistogramFailed`).
struct SpeedHistogramError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SpeedHistogramStrings.text("driveDetail.section.speedHistogramFailed", "Speed histogram failed to load")
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
                SpeedHistogramStrings.text("driveDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SpeedHistogramStrings.text("driveDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
