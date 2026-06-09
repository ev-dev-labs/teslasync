//
//  PowerProfileChart.Views.swift
//  TeslaSync — P4 feature view · 0146 · PowerProfileChart (Apple)
//
//  Panel chrome composed by `PowerProfileChart`: the header (web `ChartContainer` title +
//  freshness chip), the stale/offline connectivity banner, the loading / empty / error
//  states, and the Max Power / Max Regen / Avg footer (web stat row below the chart). The
//  trace, tooltip, and axes live in PowerProfileChart.Chart.swift. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Power Profile` with a power glyph and
/// the live-state freshness chip.
struct PowerProfileHeader: View {
    let connection: PowerProfileConnection

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(PowerProfileStyle.power)
                .accessibilityHidden(true)
            PowerProfileStrings.text("driveDetail.powerProfile", "Power Profile")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            PowerProfileFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct PowerProfileFreshnessChip: View {
    let connection: PowerProfileConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            PowerProfileStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(PowerProfileStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: PowerProfileConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live, so a
/// cached trace is clearly labeled (web `DataFreshness` intent).
struct PowerProfileConnectivityBanner: View {
    let connection: PowerProfileConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded power trace"
            : "Reconnecting — the power trace may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            PowerProfileStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: a chart-shaped block above a row of stat bars,
/// respecting Reduce Motion (via `TSSkeleton`).
struct PowerProfileLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 220, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.x2xl) {
                Spacer(minLength: 0)
                ForEach(0 ..< 3) { _ in
                    TSSkeleton(width: 72, height: 10)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(PowerProfileStrings.text("driveDetail.loading", "Loading power profile"))
    }
}

// MARK: - Empty state (web "No telemetry data available")

/// The resolved-but-empty state (web `chartData.length <= 1` → the Activity-glyph "No
/// telemetry data available" message), rendered as a `ContentUnavailableView` rather than
/// a blank box.
struct PowerProfileEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                PowerProfileStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            PowerProfileStrings.text(
                "driveDetail.emptyHint",
                "The power profile appears here once this drive has streamed a few telemetry samples."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct PowerProfileError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            PowerProfileStrings.text("driveDetail.errorTitle", "Couldn't load the power profile")
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
                PowerProfileStrings.text("driveDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(PowerProfileStrings.text("driveDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stats footer (web Max Power / Max Regen / Avg row)

/// The Max Power / Max Regen / Avg row below the chart (web stat span row). Each value is
/// colored to match the web (`text-amber-400` / `text-cyan-400` / `--text-primary`); under
/// large Dynamic Type the centered row reflows into a leading column.
struct PowerProfileStatsFooter: View {
    let stats: PowerProfileStats

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.x2xl) {
                statViews
            }
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                statViews
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    @ViewBuilder
    private var statViews: some View {
        PowerProfileStat(
            key: "driveDetail.maxPower",
            fallback: "Max Power",
            value: PowerNumberFormat.kilowattInt(stats.powerMax),
            tone: PowerProfileStyle.maxPower
        )
        PowerProfileStat(
            key: "driveDetail.maxRegen",
            fallback: "Max Regen",
            value: PowerNumberFormat.kilowattInt(stats.powerMin),
            tone: PowerProfileStyle.maxRegen
        )
        PowerProfileStat(
            key: "driveDetail.avgLabel",
            fallback: "Avg",
            value: PowerNumberFormat.kilowatt(stats.avgPower),
            tone: Color.TS.textPrimary
        )
    }

    private var accessibilityLabel: String {
        PowerProfileAccessibility.statsSummary(stats, localize: PowerProfileStrings.string)
    }
}

/// One footer stat: a muted label and its colored, monospaced value (web
/// `<span>{label}: <strong style={{ color }}>{value}</strong></span>`).
struct PowerProfileStat: View {
    let key: String
    let fallback: String
    let value: String
    let tone: Color

    var body: some View {
        HStack(spacing: 4) {
            PowerProfileStrings.text(key, fallback)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(tone)
        }
        .font(Font.TS.caption)
        .accessibilityElement(children: .combine)
    }
}
