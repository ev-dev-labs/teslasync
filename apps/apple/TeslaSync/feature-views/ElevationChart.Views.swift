//
//  ElevationChart.Views.swift
//  TeslaSync — P4 feature view · 0141 · ElevationChart (Apple)
//
//  Presentational chrome composed by `ElevationChart`: the panel header + freshness
//  chip, the elevation gain / loss / net stat row (web header above the chart), the
//  stale/offline connectivity banner, the elevation/speed metric legend, and the
//  loading / empty / error states. The Swift Charts area+line trace + its tooltip
//  live in `ElevationChart.Chart.swift`. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No networking and no Tailwind ports
//  live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title with an elevation glyph and the
/// live-state freshness chip.
struct ElevationHeader: View {
    let connection: ElevationConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "mountain.2.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            ElevationStrings.text("driveDetail.elevProfile", "Elevation Profile")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            ElevationFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat row (web gain / loss / net header)

/// The elevation summary row above the chart — the native parity of the web
/// `↗ {elevGain} m gain · ↘ {elevLoss} m loss · Net: {net} m`.
struct ElevationStatRow: View {
    let stats: ElevationStats
    let precision: Int
    @Environment(\.locale) private var locale

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            stat(
                systemImage: "arrow.up.right",
                tone: Color.TS.statusSuccess,
                value: stats.gainM,
                suffixKey: "driveDetail.gain",
                suffixFallback: "gain"
            )
            stat(
                systemImage: "arrow.down.right",
                tone: Color.TS.statusDanger,
                value: stats.lossM,
                suffixKey: "driveDetail.loss",
                suffixFallback: "loss"
            )
            netStat
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private func stat(
        systemImage: String,
        tone: Color,
        value: Double,
        suffixKey: String,
        suffixFallback: String
    ) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: "\(formatted(value)) \(metersSuffix) \(ElevationStrings.string(suffixKey, suffixFallback))")
                .font(Font.TS.caption)
                .monospacedDigit()
        }
        .foregroundStyle(tone)
    }

    private var netStat: some View {
        HStack(spacing: TSSpacing.xs) {
            ElevationStrings.text("driveDetail.net", "Net")
                .font(Font.TS.caption)
            Text(verbatim: ": \(formatted(stats.netM)) \(metersSuffix)")
                .font(Font.TS.caption)
                .monospacedDigit()
        }
        .foregroundStyle(Color.TS.textMuted)
    }

    private var metersSuffix: String {
        ElevationStrings.string("driveDetail.unit.m", "m")
    }

    private func formatted(_ value: Double) -> String {
        ElevationProjection.decimalString(value, decimals: precision, locale: locale)
    }

    private var accessibilityLabel: String {
        let gain = ElevationStrings.string("driveDetail.gain", "gain")
        let loss = ElevationStrings.string("driveDetail.loss", "loss")
        let net = ElevationStrings.string("driveDetail.net", "Net")
        return "\(formatted(stats.gainM)) \(metersSuffix) \(gain), "
            + "\(formatted(stats.lossM)) \(metersSuffix) \(loss), "
            + "\(net) \(formatted(stats.netM)) \(metersSuffix)"
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ElevationFreshnessChip: View {
    let connection: ElevationConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ElevationStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ElevationStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ElevationConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so a cached trace is clearly labeled (web `DataFreshness` intent).
struct ElevationConnectivityBanner: View {
    let connection: ElevationConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing the last recorded elevation trace"
            : "Reconnecting — elevation trace may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ElevationStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric legend (web `<Area name>` / `<Line name>`)

/// The two-series legend: a solid swatch for Elevation (m) and a faded line swatch
/// for Speed (unit), the native parity of the web `<Legend>` series names.
struct ElevationMetricLegend: View {
    let speedUnit: SpeedUnit

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            swatch(color: Color.TS.statusSuccess, label: elevationLabel, faded: false)
            swatch(color: Color.TS.chartSeriesPower, label: speedLabel, faded: true)
            Spacer(minLength: 0)
        }
    }

    private func swatch(color: Color, label: String, faded: Bool) -> some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(color.opacity(faded ? 0.6 : 1))
                .frame(width: 12, height: faded ? 3 : 10)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var elevationLabel: String {
        let name = ElevationStrings.string("driveDetail.elevation", "Elevation")
        let meters = ElevationStrings.string("driveDetail.unit.m", "m")
        return "\(name) (\(meters))"
    }

    private var speedLabel: String {
        let name = ElevationStrings.string("driveDetail.speed", "Speed")
        return "\(name) (\(speedUnit.label))"
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a muted stat row over a chart block,
/// respecting Reduce Motion (via `TSSkeleton`).
struct ElevationLoadingChart: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.lg) {
                TSSkeleton(width: 90, height: 12)
                TSSkeleton(width: 90, height: 12)
                TSSkeleton(width: 70, height: 12)
            }
            TSSkeleton(height: 220, cornerRadius: TSRadius.md)
        }
        .accessibilityElement()
        .accessibilityLabel(ElevationStrings.text("driveDetail.chart.loading", "Loading elevation profile"))
    }
}

// MARK: - Empty state (web "No telemetry data available")

/// The resolved-but-empty state: the web `chartData.length <= 1` branch (its
/// Activity glyph + "No telemetry data available") over a native
/// `ContentUnavailableView`. Never a blank box.
struct ElevationEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ElevationStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            ElevationStrings.text(
                "driveDetail.chart.emptyHint",
                "The elevation and speed trace will appear here once this drive has telemetry."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct ElevationError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ElevationStrings.text("driveDetail.chart.errorTitle", "Couldn't load the elevation profile")
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
                ElevationStrings.text("driveDetail.chart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ElevationStrings.text("driveDetail.chart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
