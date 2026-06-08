//
//  TorqueHistoryChart.Views.swift
//  TeslaSync — P4 feature view · 0164 · TorqueHistoryChart (Apple)
//
//  Presentational chrome composed by `TorqueHistoryChart`: the panel header +
//  subtitle + freshness chip, the stale/offline banner, the series styling, the
//  one-swatch legend ("Torque (Nm)"), and the loading / empty / error states. The
//  area chart itself lives in TorqueHistoryChart.Chart.swift. Copy resolves through
//  the P1/S10 facade; chrome is token-driven (P1/S9). No networking and no Tailwind
//  ports live here.
//

import SwiftUI

// MARK: - Series styling (web `stroke="#00f0ff"` + `ChartGradient`)

/// The torque series styling. The web colors the line + gradient with the literal
/// cyan `#00f0ff`, which equals `Color.TS.accent` (dark token) exactly; native
/// reads the token so the line, its gradient, and its legend swatch always agree.
enum TorqueHistoryStyle {
    /// The line stroke + legend swatch color (web `#00f0ff`).
    static var stroke: Color {
        Color.TS.accent
    }

    /// The area fill gradient (web `ChartGradient` `#00f0ff` 0.30 → 0.02 top-down).
    static var areaFill: LinearGradient {
        LinearGradient(
            colors: [Color.TS.accent.opacity(0.30), Color.TS.accent.opacity(0.02)],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title `Motor Torque` with a gauge
/// glyph + the live-state freshness chip, over the subtitle `Drive inverter torque
/// output over time`.
struct TorqueHistoryHeader: View {
    let connection: TorqueHistoryConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "gauge.with.dots.needle.bottom.50percent")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                TorqueHistoryStrings.text("drivetrain.torqueHistory", "Motor Torque")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                TorqueHistoryFreshnessChip(connection: connection)
            }
            TorqueHistoryStrings.text(
                "drivetrain.torqueHistorySub",
                "Drive inverter torque output over time"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TorqueHistoryFreshnessChip: View {
    let connection: TorqueHistoryConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TorqueHistoryStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TorqueHistoryStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TorqueHistoryConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "drivetrain.torque.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "drivetrain.torque.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "drivetrain.torque.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so a cached trace is clearly labeled (web `DataFreshness` intent).
struct TorqueHistoryConnectivityBanner: View {
    let connection: TorqueHistoryConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.torque.offlineBanner" : "drivetrain.torque.staleBanner"
        let fallback = offline
            ? "Offline — showing last known torque trace"
            : "Reconnecting — torque trace may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TorqueHistoryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web bottom `Legend` swatch)

/// The single-series legend (web `Legend` over one `Area`): a colored swatch + the
/// `Torque (Nm)` label, colored from the series stroke.
struct TorqueHistoryLegend: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(TorqueHistoryStyle.stroke)
                .frame(width: 12, height: 8)
            TorqueHistoryStrings.text("drivetrain.torque.legend", "Torque (Nm)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a muted row of sample dots over a chart
/// block, respecting Reduce Motion (via `TSSkeleton`).
struct TorqueHistoryLoadingChart: View {
    private let columns = 7

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< columns, id: \.self) { _ in
                    TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                }
                Spacer(minLength: 0)
            }
            TSSkeleton(height: 200, cornerRadius: TSRadius.md)
        }
        .frame(height: 260, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            TorqueHistoryStrings.text("drivetrain.torque.loading", "Loading motor torque history")
        )
    }
}

// MARK: - Empty state (web `return null` widened to a friendly empty surface)

/// The resolved-but-empty state (web `data.length <= 1 || all-null` → `return
/// null`), widened per the P4 contract to a native `ContentUnavailableView` with a
/// chart glyph. Never a blank box.
struct TorqueHistoryEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TorqueHistoryStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            TorqueHistoryStrings.text(
                "drivetrain.torque.emptyHint",
                "Motor torque history will appear here once drive-inverter telemetry is recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct TorqueHistoryError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TorqueHistoryStrings.text("drivetrain.torque.errorTitle", "Couldn't load motor torque history")
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
                TorqueHistoryStrings.text("drivetrain.torque.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TorqueHistoryStrings.text("drivetrain.torque.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
