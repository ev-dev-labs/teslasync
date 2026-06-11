//
//  TripReplayCharts.Views.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  Presentational chrome composed by `TripReplayCharts`: the panel header (web
//  `ChartContainer` title "Speed & Power Timeline" + subtitle "Click to seek replay
//  position") with the live-state freshness chip, the stale / offline banner, the
//  Speed / Power legend, and the loading / empty / error states. The Swift Charts trace
//  itself + its tooltip live in TripReplayCharts.Chart.swift so both files stay within
//  the file-length budget. All copy resolves through the P1/S10 facade; all chrome is
//  token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title "Speed & Power Timeline" with a
/// trace glyph + the live-state freshness chip, over the "Click to seek replay position"
/// subtitle.
struct TripReplayChartsHeader: View {
    let connection: TripReplayConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "chart.xyaxis.line")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesSpeed)
                    .accessibilityHidden(true)
                TripReplayChartsStrings.text("replay.timeline.title", "Speed & Power Timeline")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                TripReplayChartsFreshnessChip(connection: connection)
            }
            TripReplayChartsStrings.text("replay.timeline.subtitle", "Click to seek replay position")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TripReplayChartsFreshnessChip: View {
    let connection: TripReplayConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TripReplayChartsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TripReplayChartsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TripReplayConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "replay.timeline.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "replay.timeline.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "replay.timeline.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the chart when the bound source is not live,
/// so a cached trace is clearly labeled (web `DataFreshness` intent).
struct TripReplayChartsConnectivityBanner: View {
    let connection: TripReplayConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "replay.timeline.offlineBanner" : "replay.timeline.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded replay timeline"
            : "Reconnecting — replay timeline may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TripReplayChartsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (Speed / Power series swatches)

/// The two-series legend (web `<Area name="Speed">` / `<Area name="Power">`), giving each
/// color a label + its display unit so the dual-axis trace reads without color alone.
struct TripReplayChartsLegend: View {
    let speedUnit: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            swatch(
                color: Color.TS.chartSeriesSpeed,
                key: "replay.timeline.speed",
                fallback: "Speed",
                unit: speedUnit
            )
            swatch(
                color: Color.TS.chartSeriesPower,
                key: "replay.timeline.power",
                fallback: "Power",
                unit: TripReplayFormat.powerUnit
            )
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func swatch(color: Color, key: String, fallback: String, unit: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Capsule().fill(color).frame(width: 14, height: 4)
            TripReplayChartsStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: "(\(unit))")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint legend row over a muted chart block,
/// respecting Reduce Motion (via `TSSkeleton`).
struct TripReplayChartsLoading: View {
    private let dots = 2

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< dots, id: \.self) { _ in
                    TSSkeleton(width: 64, height: 10, cornerRadius: 5)
                }
                Spacer(minLength: 0)
            }
            TSSkeleton(height: 176, cornerRadius: TSRadius.md)
        }
        .frame(height: 220, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(TripReplayChartsStrings.text("replay.timeline.loading", "Loading replay timeline"))
    }
}

// MARK: - Empty state (web `Activity` overlay — "No telemetry data available")

/// The resolved-but-empty state: the web `Activity`-glyph overlay ("No telemetry data
/// available") over a native `ContentUnavailableView`. Never a blank box.
struct TripReplayChartsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TripReplayChartsStrings.text("replay.timeline.noData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        } description: {
            TripReplayChartsStrings.text(
                "replay.timeline.emptyHint",
                "The speed and power timeline appears here once this trip has telemetry samples."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline
/// error treatment used across the feature-view surfaces.
struct TripReplayChartsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TripReplayChartsStrings.text("replay.timeline.errorTitle", "Couldn't load the replay timeline")
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
                TripReplayChartsStrings.text("replay.timeline.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TripReplayChartsStrings.text("replay.timeline.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
