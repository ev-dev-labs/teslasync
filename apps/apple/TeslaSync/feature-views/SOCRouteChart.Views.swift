//
//  SOCRouteChart.Views.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  Presentational chrome composed by `SOCRouteChart`: the panel header + freshness
//  chip, the stale/offline banner, and the loading / empty / error states. The Swift
//  Charts area chart itself lives in `SOCRouteChart.Chart.swift`. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No networking and
//  no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Battery Along Route` with a
/// battery glyph + the live-state freshness chip.
struct SOCRouteChartHeader: View {
    let connection: SOCRouteChartConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.batteryblock.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesBattery)
                .accessibilityHidden(true)
            SOCRouteChartStrings.text("tripPlanner.socChart.title", "Battery Along Route")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            SOCRouteChartFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SOCRouteChartFreshnessChip: View {
    let connection: SOCRouteChartConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SOCRouteChartStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SOCRouteChartStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SOCRouteChartConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "tripPlanner.socChart.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "tripPlanner.socChart.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "tripPlanner.socChart.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so a cached curve is clearly labeled (web `DataFreshness` intent).
struct SOCRouteChartConnectivityBanner: View {
    let connection: SOCRouteChartConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tripPlanner.socChart.offlineBanner" : "tripPlanner.socChart.staleBanner"
        let fallback = offline
            ? "Offline — showing the last planned route"
            : "Reconnecting — the planned route may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SOCRouteChartStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: a faint baseline under a muted chart block,
/// respecting Reduce Motion (via `TSSkeleton`).
struct SOCRouteChartLoadingChart: View {
    private let dots = 6

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< dots, id: \.self) { _ in
                    TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                }
                Spacer(minLength: 0)
            }
            TSSkeleton(height: 208, cornerRadius: TSRadius.md)
        }
        .frame(height: 260, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SOCRouteChartStrings.text("tripPlanner.socChart.loading", "Loading planned route"))
    }
}

// MARK: - Empty state (web `EmptyState` — "Plan a trip to see the SOC curve")

/// The resolved-but-empty state: the web `EmptyState` ("Plan a trip to see the SOC
/// curve") over a native `ContentUnavailableView`. Never a blank box.
struct SOCRouteChartEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SOCRouteChartStrings.text("tripPlanner.socChart.empty", "Plan a trip to see the SOC curve")
            } icon: {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
            }
        } description: {
            SOCRouteChartStrings.text(
                "tripPlanner.socChart.emptyHint",
                "The battery curve appears here once you plan a trip with a destination."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 260)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SOCRouteChartError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SOCRouteChartStrings.text("tripPlanner.socChart.errorTitle", "Couldn't load the planned route")
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
                SOCRouteChartStrings.text("tripPlanner.socChart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SOCRouteChartStrings.text("tripPlanner.socChart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
