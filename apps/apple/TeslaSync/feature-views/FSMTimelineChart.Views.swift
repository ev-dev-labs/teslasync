//
//  FSMTimelineChart.Views.swift
//  TeslaSync — P4 feature view · 0231 · FSMTimelineChart (Apple)
//
//  Presentational chrome composed by `FSMTimelineChart`: the panel header + freshness
//  chip, the stale/offline banner, and the loading / empty / error states. The Swift
//  Charts stacked area itself lives in `FSMTimelineChart.Chart.swift`. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Transitions Over Time` with a
/// timeline glyph + the live-state freshness chip.
struct FSMTimelineHeader: View {
    let connection: FSMTimelineConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesSpeed)
                .accessibilityHidden(true)
            FSMTimelineChartStrings.text("fsm.timelineChart", "Transitions Over Time")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            FSMTimelineFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct FSMTimelineFreshnessChip: View {
    let connection: FSMTimelineConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            FSMTimelineChartStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(FSMTimelineChartStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: FSMTimelineConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "fsm.timelineChart.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "fsm.timelineChart.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "fsm.timelineChart.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so a cached timeline is clearly labeled (web `DataFreshness` intent).
struct FSMTimelineConnectivityBanner: View {
    let connection: FSMTimelineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "fsm.timelineChart.offlineBanner" : "fsm.timelineChart.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded transitions"
            : "Reconnecting — the transition timeline may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FSMTimelineChartStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: faint stacked-bar skeleton blocks under a muted
/// chart block, respecting Reduce Motion (via `TSSkeleton`).
struct FSMTimelineLoadingChart: View {
    private let bars = 7

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.sm) {
                ForEach(0 ..< bars, id: \.self) { index in
                    TSSkeleton(height: Self.height(for: index), cornerRadius: TSRadius.sm)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 180, alignment: .bottom)
            TSSkeleton(width: 120, height: 10, cornerRadius: 5)
        }
        .frame(height: 220, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(FSMTimelineChartStrings.text("fsm.timelineChart.loading", "Loading transitions"))
    }

    private static func height(for index: Int) -> CGFloat {
        let pattern: [CGFloat] = [70, 120, 95, 150, 110, 80, 135]
        return pattern[index % pattern.count]
    }
}

// MARK: - Empty state (web `EmptyState` — "No transition data for timeline")

/// The resolved-but-empty state: the web `EmptyState` ("No transition data for
/// timeline", or the parent-supplied `emptyMessage`) over a native
/// `ContentUnavailableView`. Never a blank box.
struct FSMTimelineEmpty: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        } description: {
            FSMTimelineChartStrings.text(
                "fsm.timelineChart.emptyHint",
                "The stacked timeline appears here once transitions are recorded in the window."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct FSMTimelineError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FSMTimelineChartStrings.text("fsm.timelineChart.errorTitle", "Couldn't load transitions")
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
                FSMTimelineChartStrings.text("fsm.timelineChart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FSMTimelineChartStrings.text("fsm.timelineChart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
