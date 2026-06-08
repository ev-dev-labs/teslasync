//
//  TemperatureTrendChart.Views.swift
//  TeslaSync — P4 feature view · 0162 · TemperatureTrendChart (Apple)
//
//  Presentational chrome composed by `TemperatureTrendChart`: the panel header +
//  subtitle + freshness chip, the stale/offline banner, the single-series Swift Charts
//  line chart (web Recharts `LineChart` → native `Chart { LineMark }`) with its Warm
//  Zone / Freezing reference rules (web `<ReferenceLine>` → `RuleMark`), its selection
//  tooltip (web `ChartTooltip`) + bottom legend (web `<Legend>` "Outside Temp"), and
//  the loading / empty / error states. Copy resolves through the P1/S10 facade; chrome
//  is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Localized Text helper (P1/S10)

/// SwiftUI `Text` for a surface key with the web English fallback. Kept beside the
/// views so the Foundation-only model file holds no SwiftUI.
extension TemperatureTrendStrings {
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Palette (web hex → design tokens)

/// The chart's color roles. The web outside-temp line + Freezing rule are `#06b6d4`,
/// which is exactly the cyan `Color.TS.chartSeriesRegen` token value; the Warm Zone
/// rule is `#f59e0b`, the amber `Color.TS.statusWarning` token — so light / dark /
/// high-contrast all resolve.
enum TemperatureTrendPalette {
    static let line = Color.TS.chartSeriesRegen

    static func color(for kind: TemperatureTrendThresholdKind) -> Color {
        switch kind {
        case .warmZone: Color.TS.statusWarning
        case .freezing: Color.TS.chartSeriesRegen
        }
    }
}

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title `Temperature Trend` with a thermo
/// glyph + the live-state freshness chip, over the subtitle `Outside temperature
/// recorded during recent drives`.
struct TemperatureTrendHeader: View {
    let connection: TemperatureTrendConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "thermometer.medium")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(TemperatureTrendPalette.line)
                    .accessibilityHidden(true)
                TemperatureTrendStrings.text("drivetrain.tempHistory", "Temperature Trend")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                TemperatureTrendFreshnessChip(connection: connection)
            }
            TemperatureTrendStrings.text(
                "drivetrain.tempHistorySub",
                "Outside temperature recorded during recent drives"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TemperatureTrendFreshnessChip: View {
    let connection: TemperatureTrendConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TemperatureTrendStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TemperatureTrendStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TemperatureTrendConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "drivetrain.temp.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "drivetrain.temp.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "drivetrain.temp.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so a cached trend is clearly labeled (web `DataFreshness` intent).
struct TemperatureTrendConnectivityBanner: View {
    let connection: TemperatureTrendConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.temp.offlineBanner" : "drivetrain.temp.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded temperature trend"
            : "Reconnecting — temperature trend may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TemperatureTrendStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web bottom `<Legend>` swatch)

/// The single-series legend (web `Outside Temp`): a colored swatch + the series label.
struct TemperatureTrendLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(TemperatureTrendPalette.line)
                .frame(width: 12, height: 8)
            TemperatureTrendStrings.text("drivetrain.outsideTemp", "Outside Temp")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint baseline with a muted trend line of
/// dots, respecting Reduce Motion (via `TSSkeleton`).
struct TemperatureTrendLoadingChart: View {
    private let columns = 7

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< columns, id: \.self) { _ in
                    TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                }
                Spacer(minLength: 0)
            }
            TSSkeleton(height: 150, cornerRadius: TSRadius.md)
        }
        .frame(height: 280, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            TemperatureTrendStrings.text("drivetrain.temp.loading", "Loading temperature trend")
        )
    }
}

// MARK: - Empty state (web `data.length <= 1 → null`, surfaced as a friendly empty)

/// The resolved-but-no-trend state: the web returns `null` for ≤ 1 drive; native shows
/// a `ContentUnavailableView` with a chart glyph so the panel is never a blank box.
struct TemperatureTrendEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TemperatureTrendStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            TemperatureTrendStrings.text(
                "drivetrain.temp.emptyHint",
                "Outside temperature trends will appear here once at least two recent drives are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct TemperatureTrendError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TemperatureTrendStrings.text("drivetrain.temp.errorTitle", "Couldn't load temperature trend")
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
                TemperatureTrendStrings.text("drivetrain.temp.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TemperatureTrendStrings.text("drivetrain.temp.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
