//
//  ChargerTypeChart.Views.swift
//  TeslaSync — P4 feature view · 0087 · ChargerTypeChart (Apple)
//
//  Presentational chrome composed by `ChargerTypeChart`: the charger palette, the
//  panel header + freshness chip, the subtitle, the stale/offline connectivity
//  banner, the metric legend, the per-charger breakdown rows (web bottom list), the
//  data table (web `ChartContainer` dataColumns), and the loading / empty / error
//  states. The clustered Swift Charts bar chart + its tooltip live in
//  `ChargerTypeChart.Chart.swift`. All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Charger palette (web CHARGER_COLORS intent → adaptive tokens)

/// The charger → fill mapping. The web `CHARGER_COLORS` keys its colors by the
/// internal labels supercharger `#ef4444` / dc `#f59e0b` / home `#10b981`; native
/// maps each charger type to the equivalent adaptive semantic token so light /
/// dark / high-contrast all resolve correctly. The energy series is rendered at a
/// reduced opacity (web `<Bar opacity={0.6}>`).
enum ChargerTypePalette {
    static func color(for type: ChargerType) -> Color {
        switch type {
        case .supercharger: Color.TS.statusDanger
        case .dcFast: Color.TS.statusWarning
        case .homeAC: Color.TS.statusSuccess
        }
    }

    static func barColor(for type: ChargerType, metric: ChargerMetric) -> Color {
        let base = color(for: type)
        return metric == .energy ? base.opacity(0.6) : base
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title with a charger glyph (web
/// lucide chart intent) and the live-state freshness chip.
struct ChargerTypeHeader: View {
    let connection: ChargerTypeConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            ChargerTypeStrings.text("charging.curve.chargerType", "Charge Rate by Charger Type")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            ChargerTypeFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Subtitle (web `ChartContainer` subtitle)

/// The panel subtitle (web `subtitle` prop).
struct ChargerTypeSubtitle: View {
    var body: some View {
        ChargerTypeStrings.text(
            "charging.curve.chargerTypeDesc",
            "Average kW and kWh per charger category"
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ChargerTypeFreshnessChip: View {
    let connection: ChargerTypeConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ChargerTypeStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChargerTypeStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ChargerTypeConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so cached columns are clearly labeled (web `DataFreshness` intent).
struct ChargerTypeConnectivityBanner: View {
    let connection: ChargerTypeConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing last known charging sessions"
            : "Reconnecting — charging stats may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ChargerTypeStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Metric legend (web `<Bar name=…>` distinction)

/// The two-series legend: a solid swatch for Avg Power (kW) and a faded swatch for
/// Avg Energy (kWh), explaining the per-charger clustered bars + their opacity.
struct ChargerTypeMetricLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(ChargerMetric.allCases.sorted { $0.order < $1.order }) { metric in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color.TS.textSecondary.opacity(metric == .energy ? 0.5 : 1))
                        .frame(width: 10, height: 10)
                    ChargerTypeStrings.text(metric.localizationKey, metric.fallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Breakdown rows (web bottom list)

/// The per-charger summary rows — the native parity of the web bottom list
/// (`{count} sessions · {avgDuration} min avg`), each with the charger's color
/// swatch + localized name.
struct ChargerTypeBreakdownRows: View {
    let points: [ChargerTypePoint]
    @Environment(\.locale) private var locale

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(points) { point in
                HStack(spacing: TSSpacing.sm) {
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(ChargerTypePalette.color(for: point.type))
                            .frame(width: 8, height: 8)
                        ChargerTypeStrings.text(point.type.localizationKey, point.type.fallback)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: summary(for: point))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .monospacedDigit()
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: rowAccessibility(for: point)))
            }
        }
    }

    private func summary(for point: ChargerTypePoint) -> String {
        let count = ChargerTypeProjection.intString(Double(point.count), locale: locale)
        let mins = ChargerTypeProjection.intString(point.avgDurationMin, locale: locale)
        let sessions = ChargerTypeStrings.string("charging.curve.sessions", "sessions")
        let minAvg = ChargerTypeStrings.string("charging.curve.minAvg", "min avg")
        return "\(count) \(sessions) · \(mins) \(minAvg)"
    }

    private func rowAccessibility(for point: ChargerTypePoint) -> String {
        let name = ChargerTypeStrings.string(point.type.localizationKey, point.type.fallback)
        return ChargerTypeAccessibility.rowLabel(point, name: name, locale: locale, localize: ChargerTypeStrings.string)
    }
}

// MARK: - Data table (web `ChartContainer` dataColumns)

/// The accessible data table — the native parity of the web `ChartContainer`
/// `data` + `dataColumns` fallback (Charger Type / Sessions / Avg kW / Avg kWh /
/// Avg minutes), carrying the same figures the chart encodes.
struct ChargerTypeDataTable: View {
    let points: [ChargerTypePoint]
    @Environment(\.locale) private var locale

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.xs) {
            GridRow {
                headerCell("charging.curve.col.charger", "Charger Type", alignment: .leading)
                headerCell("charging.curve.col.sessions", "Sessions", alignment: .trailing)
                headerCell("charging.curve.col.avgKw", "Avg kW", alignment: .trailing)
                headerCell("charging.curve.col.avgKwh", "Avg kWh", alignment: .trailing)
                headerCell("charging.curve.col.avgMin", "Avg minutes", alignment: .trailing)
            }
            ForEach(points) { point in
                Divider().gridCellColumns(5).overlay(Color.TS.border)
                GridRow {
                    HStack(spacing: TSSpacing.xs) {
                        Circle()
                            .fill(ChargerTypePalette.color(for: point.type))
                            .frame(width: 7, height: 7)
                        ChargerTypeStrings.text(point.type.localizationKey, point.type.fallback)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textPrimary)
                    }
                    valueCell(ChargerTypeProjection.intString(Double(point.count), locale: locale))
                    valueCell(ChargerTypeProjection.decimalString(point.avgKw, decimals: 1, locale: locale))
                    valueCell(ChargerTypeProjection.decimalString(point.avgKwh, decimals: 1, locale: locale))
                    valueCell(ChargerTypeProjection.intString(point.avgDurationMin, locale: locale))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHidden(true)
    }

    private func headerCell(_ key: String, _ fallback: String, alignment: HorizontalAlignment) -> some View {
        ChargerTypeStrings.text(key, fallback)
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

/// The initial-fetch skeleton chrome: a row of muted clustered bars under a faint
/// baseline, respecting Reduce Motion (via `TSSkeleton`).
struct ChargerTypeLoadingChart: View {
    private let heights: [CGFloat] = [180, 120, 150, 96, 132, 80]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.md) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 22, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 240, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(ChargerTypeStrings.text("charging.curve.chart.loading", "Loading charging stats"))
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-empty state: the web `chargerTypeStats.length === 0` branch
/// over a native `ContentUnavailableView` with a charger glyph. Never a blank box.
struct ChargerTypeEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ChargerTypeStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            ChargerTypeStrings.text(
                "charging.curve.chart.emptyHint",
                "Charger breakdown will appear here once charging sessions are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct ChargerTypeError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChargerTypeStrings.text("charging.curve.chart.errorTitle", "Couldn't load charging stats")
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
                ChargerTypeStrings.text("charging.curve.chart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargerTypeStrings.text("charging.curve.chart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
