//
//  SessionCurveChart.Views.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  Presentational chrome composed by `SessionCurveChart`: the panel header +
//  freshness chip (web `ChartContainer` title), the subtitle (web `subtitle`), the
//  stale/offline connectivity banner, and the loading / empty / error states. The
//  Swift Charts area chart + its tooltip + accessible descriptor live in
//  `SessionCurveChart.Chart.swift`. All copy resolves through the P1/S10 facade; all
//  chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web `ChartContainer` title + freshness chip)

/// The panel header: the web `ChartContainer` title "Power vs SOC" with a charging
/// glyph and the live-state freshness chip.
struct SessionCurveHeader: View {
    let connection: SessionCurveConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.chartCategorical[0])
                .accessibilityHidden(true)
            SessionCurveStrings.text("charging.curve.powerVsSoc", "Power vs SOC")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            SessionCurveFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Subtitle (web `ChartContainer` subtitle)

/// The panel subtitle (web `subtitle` prop): "Charging power curve for selected
/// session".
struct SessionCurveSubtitle: View {
    var body: some View {
        SessionCurveStrings.text(
            "charging.curve.powerVsSocDesc",
            "Charging power curve for selected session"
        )
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SessionCurveFreshnessChip: View {
    let connection: SessionCurveConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SessionCurveStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SessionCurveStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: SessionCurveConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not
/// live, so the cached curve is clearly labeled (web `DataFreshness` intent).
struct SessionCurveConnectivityBanner: View {
    let connection: SessionCurveConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded charging curve"
            : "Reconnecting — the charging curve may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SessionCurveStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: a curve-suggesting row of muted bars under a
/// faint baseline, respecting Reduce Motion (via `TSSkeleton`). The descending
/// heights echo a DC taper so the loading chrome reads as a charging curve.
struct SessionCurveLoadingChart: View {
    private let heights: [CGFloat] = [220, 220, 220, 220, 220, 198, 176, 150, 122, 96, 72, 52]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 16, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 320, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(SessionCurveStrings.text("charging.curve.chart.loading", "Loading charging curve"))
    }
}

// MARK: - Empty state (web `EmptyState` — "No data available")

/// The resolved-but-empty state: no curve points for the selected session, over a
/// native `ContentUnavailableView` with a charging glyph. Never a blank box.
struct SessionCurveEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionCurveStrings.text("common.noData", "No data available")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            SessionCurveStrings.text(
                "charging.curve.chart.emptyHint",
                "The power curve will appear here once a charging session is selected."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 320)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct SessionCurveError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SessionCurveStrings.text("charging.curve.chart.errorTitle", "Couldn't load the charging curve")
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
                SessionCurveStrings.text("charging.curve.chart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SessionCurveStrings.text("charging.curve.chart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
