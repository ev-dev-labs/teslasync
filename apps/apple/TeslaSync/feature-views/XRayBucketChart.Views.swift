//
//  XRayBucketChart.Views.swift
//  TeslaSync — P4 feature view · 0032 · XRayBucketChart (Apple)
//
//  Presentational chrome composed by `XRayBucketChart`: the bar palette, the panel
//  header (title + subtitle + freshness chip), the stale/offline connectivity banner,
//  and the loading / empty / error states. The single-series Swift Charts bar chart +
//  its tooltip live in `XRayBucketChart.Chart.swift`. All copy resolves through the
//  P1/S10 facade; all chrome is token-driven (P1/S9). No networking and no Tailwind
//  ports here.
//

import SwiftUI

// MARK: - Palette (web `<Bar fill="var(--accent-primary)">` → accent token)

/// The bucket bar fill. The web binds `var(--accent-primary)`; the generated
/// `Color.TS.accent` is that same brand accent and resolves correctly across
/// light / dark / high-contrast.
enum XRayBucketPalette {
    static let bar = Color.TS.accent
}

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header — the web `ChartContainer` title (`Samples per bucket`) with a bar
/// glyph + the live-state freshness chip, over the container subtitle.
struct XRayBucketHeader: View {
    let connection: XRayBucketConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(XRayBucketPalette.bar)
                    .accessibilityHidden(true)
                XRayBucketStrings.text("admin.xray.chart.title", "Samples per bucket")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                XRayBucketFreshnessChip(connection: connection)
            }
            XRayBucketStrings.text(
                "admin.xray.chart.subtitle",
                "Time-series of ingested telemetry rows over the selected window."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct XRayBucketFreshnessChip: View {
    let connection: XRayBucketConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            XRayBucketStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(XRayBucketStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: XRayBucketConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "admin.xray.chart.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "admin.xray.chart.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "admin.xray.chart.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live, so
/// cached bars are clearly labeled (web `DataFreshness` intent).
struct XRayBucketConnectivityBanner: View {
    let connection: XRayBucketConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.xray.chart.offlineBanner" : "admin.xray.chart.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded sample counts"
            : "Reconnecting — sample counts may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            XRayBucketStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `ChartContainer` loading chrome)

/// The initial-fetch skeleton chrome: a row of muted bars under a faint baseline,
/// respecting Reduce Motion (via `TSSkeleton`).
struct XRayBucketLoadingChart: View {
    private let heights: [CGFloat] = [70, 120, 96, 150, 180, 130, 88, 60]

    var body: some View {
        HStack(alignment: .bottom, spacing: TSSpacing.sm) {
            ForEach(Array(heights.enumerated()), id: \.offset) { _, height in
                TSSkeleton(width: 22, height: height, cornerRadius: 3)
            }
            Spacer(minLength: 0)
        }
        .frame(height: 220, alignment: .bottom)
        .accessibilityElement()
        .accessibilityLabel(XRayBucketStrings.text("admin.xray.chart.loading", "Loading sample counts"))
    }
}

// MARK: - Empty state (web `!loading && series.length === 0` branch)

/// The resolved-but-empty state: the web empty branch as a native
/// `ContentUnavailableView`. Never a blank box.
struct XRayBucketEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                XRayBucketStrings.text("admin.xray.chart.emptyTitle", "No samples")
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            XRayBucketStrings.text(
                "admin.xray.chart.empty",
                "No samples in this window. Try widening the window or confirm the vehicle is publishing."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
    }
}

// MARK: - Error state (web `QueryError` / section error boundary)

/// The fetch-failure state with a retry affordance — the native parity of the admin
/// X-Ray section error boundary.
struct XRayBucketError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            XRayBucketStrings.text("admin.xray.chart.errorTitle", "Couldn't load sample counts")
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
                XRayBucketStrings.text("admin.xray.chart.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(XRayBucketStrings.text("admin.xray.chart.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
