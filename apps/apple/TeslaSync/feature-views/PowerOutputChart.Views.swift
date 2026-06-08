//
//  PowerOutputChart.Views.swift
//  TeslaSync — P4 feature view · 0158 · PowerOutputChart (Apple)
//
//  Panel chrome composed by `PowerOutputChart`: the header (title + subtitle + freshness
//  chip + data-export menu), the stale/offline connectivity banner, and the loading /
//  empty / error states. The overlaid chart, tooltip, and toggle legend live in
//  PowerOutputChart.Chart.swift. All copy resolves through the P1/S10 facade; all chrome
//  is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + subtitle + freshness chip + export)

/// The panel header: the web `ChartContainer` title `Power Output History` + subtitle
/// `Peak and regen power per drive over time`, with a drivetrain glyph, the live-state
/// freshness chip, and the copy-data export affordance (web `ChartContainer` export menu).
struct PowerOutputHeader: View {
    let connection: PowerOutputConnection
    let canExport: Bool
    let onExport: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesPower)
                    .accessibilityHidden(true)
                PowerOutputStrings.text("drivetrain.powerOutput", "Power Output History")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                PowerOutputFreshnessChip(connection: connection)
                if canExport {
                    PowerOutputExportButton(action: onExport)
                }
            }
            PowerOutputStrings.text(
                "drivetrain.powerOutputSub",
                "Peak and regen power per drive over time"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Export button (web `ChartContainer` copy-data menu)

/// Copies the chart's data as CSV to the clipboard (web `ChartContainer` export menu).
struct PowerOutputExportButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(PowerOutputStrings.text("drivetrain.export", "Copy chart data"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct PowerOutputFreshnessChip: View {
    let connection: PowerOutputConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            PowerOutputStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(PowerOutputStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: PowerOutputConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "drivetrain.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "drivetrain.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "drivetrain.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live, so a
/// cached trend is clearly labeled (web `DataFreshness` intent).
struct PowerOutputConnectivityBanner: View {
    let connection: PowerOutputConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.offlineBanner" : "drivetrain.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded drives"
            : "Reconnecting — power history may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            PowerOutputStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: a chart-shaped block above a row of legend stubs,
/// respecting Reduce Motion (via `TSSkeleton`).
struct PowerOutputLoadingChart: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 300, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< 2) { _ in
                    TSSkeleton(width: 96, height: 10)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(PowerOutputStrings.text("drivetrain.loading", "Loading power output history"))
    }
}

// MARK: - Empty state (web `data.length <= 1` → friendly state)

/// The resolved-but-empty state (web `data.length <= 1` → `null`), rendered as a native
/// `ContentUnavailableView` rather than a hidden/blank panel.
struct PowerOutputEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                PowerOutputStrings.text("drivetrain.emptyTitle", "Not enough drives yet")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            PowerOutputStrings.text(
                "drivetrain.emptyHint",
                "Peak and regen power appears here once your vehicle logs a couple of drives."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct PowerOutputError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            PowerOutputStrings.text("drivetrain.errorTitle", "Couldn't load power output history")
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
                PowerOutputStrings.text("drivetrain.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(PowerOutputStrings.text("drivetrain.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
