//
//  MotorHistoryCharts.Views.swift
//  TeslaSync — P4 feature view · 0172 · MotorHistoryCharts (Apple)
//
//  Presentational chrome composed by `MotorHistoryCharts`: the per-chart panel
//  (title + subtitle + freshness chip), the stale/offline connectivity banner, the
//  interactive + static legends (web `ChartLegend` / `Legend`), the selection
//  tooltip (web `ChartTooltip`), and the loading / empty / error states (web
//  `EmptyState` / `QueryError`). The Swift Charts traces themselves live in
//  MotorHistoryCharts.Charts.swift. All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9). No networking and no Tailwind ports here.
//

import SwiftUI

// MARK: - Section card (one web `ChartContainer`)

/// One motor-history chart card — the native parity of a single web
/// `ChartContainer`: a titled, subtitled panel that switches over the bound phase
/// so loading / empty / error / content all render, never a blank box. The chart
/// itself is supplied by the caller and shown only in the content phase.
struct MotorHistoryChartsSection<ChartBody: View>: View {
    let title: String
    let subtitle: String
    let ariaLabel: String
    let phase: MotorHistoryChartsPhase
    let connection: MotorHistoryChartsConnection
    let onRetry: () -> Void
    @ViewBuilder var chart: () -> ChartBody

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            content
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ariaLabel))
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                if connection != .live {
                    MotorHistoryChartsFreshnessChip(connection: connection)
                }
            }
            Text(verbatim: subtitle)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .loading:
            MotorHistoryChartsLoading()
        case let .error(message):
            MotorHistoryChartsError(message: message, onRetry: onRetry)
        case .empty:
            MotorHistoryChartsEmpty()
        case .content:
            chart()
        }
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
/// Only shown when not live (web shows no indicator on a healthy stream).
struct MotorHistoryChartsFreshnessChip: View {
    let connection: MotorHistoryChartsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            MotorHistoryChartsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(MotorHistoryChartsStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: MotorHistoryChartsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "dynamics.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "dynamics.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "dynamics.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the charts when the bound source is not
/// live, so cached traces are clearly labeled while reconnecting / offline.
struct MotorHistoryChartsBanner: View {
    let connection: MotorHistoryChartsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "dynamics.motorHistory.offlineBanner" : "dynamics.motorHistory.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded motor telemetry"
            : "Reconnecting — motor telemetry may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            MotorHistoryChartsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web `ChartLegend` interactive / `Legend` static)

/// One legend swatch descriptor (web series).
struct MotorHistoryLegendItem: Identifiable {
    let id: String
    let name: String
    let color: Color
}

/// The chart legend. With `onToggle` it is interactive (web `ChartLegend`: tapping
/// a series hides/shows it, struck-through when hidden); without it, it is the web
/// static `Legend`.
struct MotorHistoryChartsLegend: View {
    let items: [MotorHistoryLegendItem]
    var hidden: Set<String> = []
    var onToggle: ((String) -> Void)?

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(items) { item in
                if let onToggle {
                    Button { onToggle(item.id) } label: { swatch(item) }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(
                            hidden.contains(item.id) ? .isButton : [.isButton, .isSelected]
                        )
                } else {
                    swatch(item)
                }
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func swatch(_ item: MotorHistoryLegendItem) -> some View {
        let isHidden = hidden.contains(item.id)
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(item.color)
                .frame(width: 8, height: 8)
                .opacity(isHidden ? 0.3 : 1)
            Text(verbatim: item.name)
                .font(Font.TS.caption)
                .foregroundStyle(isHidden ? Color.TS.textMuted : Color.TS.textSecondary)
                .strikethrough(isHidden)
        }
    }
}

// MARK: - Tooltip (web `ChartTooltip`)

/// One tooltip row: a colored series swatch + name + the value at the selected time.
struct MotorHistoryTooltipRow: Identifiable {
    let id: String
    let name: String
    let color: Color
    let value: String
}

/// The selection tooltip — the native parity of the web `ChartTooltip` payload:
/// the sample time over one row per visible series.
struct MotorHistoryChartsTooltip: View {
    let title: String
    let rows: [MotorHistoryTooltipRow]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            ForEach(rows) { row in
                HStack(spacing: TSSpacing.sm) {
                    Circle().fill(row.color).frame(width: 7, height: 7)
                    Text(verbatim: row.name)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: row.value)
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
        .frame(minWidth: 148, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint rising line of muted bars, respecting
/// Reduce Motion (via `TSSkeleton`).
struct MotorHistoryChartsLoading: View {
    private let heights: [CGFloat] = [40, 64, 92, 78, 116, 140, 120, 150, 132, 96, 70, 48]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 12, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 220, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(
            MotorHistoryChartsStrings.text("dynamics.motorHistory.loading", "Loading motor telemetry")
        )
    }
}

// MARK: - Empty state (web `EmptyState` — "Awaiting motor telemetry data...")

/// The resolved-but-empty state: the web `<EmptyState>` over a native
/// `ContentUnavailableView` with the activity glyph (web lucide `Activity`). Never
/// a blank box.
struct MotorHistoryChartsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                MotorHistoryChartsStrings.text("dynamics.awaitingData", "Awaiting motor telemetry data...")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            MotorHistoryChartsStrings.text(
                "dynamics.motorHistory.emptyHint",
                "Motor power, torque and rpm traces appear here once the vehicle is driving."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct MotorHistoryChartsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            MotorHistoryChartsStrings.text(
                "dynamics.motorHistory.errorTitle",
                "Couldn't load motor telemetry"
            )
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
                MotorHistoryChartsStrings.text("dynamics.motorHistory.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(MotorHistoryChartsStrings.text("dynamics.motorHistory.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
