//
//  CostPerKwhChart.Views.swift
//  TeslaSync — P4 feature view · 0110 · CostPerKwhChart (Apple)
//
//  Presentational chrome composed by `CostPerKwhChart`: the panel header (the web
//  `BarChart3` title) + the live-state freshness chip, the stale/offline
//  connectivity banner, and the loading / empty / error states (the web `noData`
//  empty message widened to the full load envelope). All copy resolves through the
//  P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no Tailwind
//  ports live here.
//

import SwiftUI

// MARK: - Palette (web static colors → adaptive semantic tokens)

/// The surface's small color map. The web title icon is `text-purple-400` and the
/// line uses the CB-safe chart palette index 2; native uses the adaptive tokens so
/// light / dark / high-contrast all resolve correctly.
enum CostPerKwhPalette {
    /// The trend line color — web `palette[2]` (CB-safe Okabe-Ito index 2).
    static var line: Color {
        TSChartPalette.color(at: 2)
    }

    /// The header glyph tint — web `text-purple-400` accent on the `BarChart3`.
    static var headerIcon: Color {
        Color.TS.chartSeriesPower
    }
}

// MARK: - Header (web `<h3>` with the `BarChart3` icon + title)

/// The panel header: the web purple chart glyph, the "Cost per kWh Trend" title,
/// and the live-state freshness chip pushed to the trailing edge.
struct CostPerKwhHeader: View {
    let connection: CostPerKwhConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "chart.xyaxis.line")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(CostPerKwhPalette.headerIcon)
                .accessibilityHidden(true)
            CostPerKwhStrings.text("costAnalysis.charts.costPerKwh", "Cost per kWh Trend")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            CostPerKwhFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct CostPerKwhFreshnessChip: View {
    let connection: CostPerKwhConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            CostPerKwhStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CostPerKwhStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: CostPerKwhConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "costAnalysis.charts.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "costAnalysis.charts.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "costAnalysis.charts.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so the cached trend is clearly labeled, with a retry affordance.
struct CostPerKwhConnectivityBanner: View {
    let connection: CostPerKwhConnection
    let onRetry: () -> Void

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "costAnalysis.charts.offlineBanner" : "costAnalysis.charts.staleBanner"
        let fallback = offline
            ? "Offline — showing last known cost data"
            : "Reconnecting — cost data may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            CostPerKwhStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRetry) {
                CostPerKwhStrings.text("costAnalysis.charts.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.accent)
            .accessibilityLabel(CostPerKwhStrings.text("costAnalysis.charts.retry", "Retry"))
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

/// The initial-fetch skeleton chrome: a muted chart-area block at the web chart
/// height, respecting Reduce Motion (via `TSSkeleton`). Never a frozen UI.
struct CostPerKwhLoading: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 140, height: 14, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 232, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(CostPerKwhStrings.text("costAnalysis.charts.a11y.loading", "Loading cost per kWh trend"))
    }
}

// MARK: - Empty state (web centered `noData` — "Not enough data")

/// The resolved-but-empty state: the web `<div … >{t('…noData')}</div>` over a
/// native `ContentUnavailableView` with the chart glyph, held at the web chart
/// height so the panel never collapses to a blank box.
struct CostPerKwhEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                CostPerKwhStrings.text("costAnalysis.charts.noData", "Not enough data")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance. The web presentational
/// component has no error branch (its parent owns the lifecycle); the native
/// surface reproduces the parent's failure envelope so the prompt's error state
/// always renders.
struct CostPerKwhError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            CostPerKwhStrings.text("costAnalysis.charts.errorTitle", "Couldn't load cost per kWh trend")
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
                CostPerKwhStrings.text("costAnalysis.charts.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CostPerKwhStrings.text("costAnalysis.charts.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 260)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
