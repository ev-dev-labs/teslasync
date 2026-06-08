//
//  SessionComparisonChart.Views.swift
//  TeslaSync — P4 feature view · 0089 · SessionComparisonChart (Apple)
//
//  Panel chrome composed by `SessionComparisonChart`: the header (title + subtitle +
//  freshness chip), the stale/offline connectivity banner, and the loading / empty /
//  error states. The overlaid chart, tooltip, and legend live in
//  SessionComparisonChart.Chart.swift. All copy resolves through the P1/S10 facade;
//  all chrome is token-driven (P1/S9). No networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title `Session Comparison` + subtitle
/// `Power curves overlaid from last 10 sessions`, with a charging glyph and the
/// live-state freshness chip.
struct SessionComparisonHeader: View {
    let connection: ComparisonConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SessionComparisonStrings.text("charging.curve.sessionComparison", "Session Comparison")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                SessionComparisonFreshnessChip(connection: connection)
            }
            SessionComparisonStrings.text(
                "charging.curve.sessionComparisonDesc",
                "Power curves overlaid from last 10 sessions"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct SessionComparisonFreshnessChip: View {
    let connection: ComparisonConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SessionComparisonStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SessionComparisonStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ComparisonConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "charging.curve.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "charging.curve.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "charging.curve.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live,
/// so cached curves are clearly labeled (web `DataFreshness` intent).
struct SessionComparisonConnectivityBanner: View {
    let connection: ComparisonConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "charging.curve.offlineBanner" : "charging.curve.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded sessions"
            : "Reconnecting — comparison may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SessionComparisonStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: a chart-shaped block above a row of legend
/// stubs, respecting Reduce Motion (via `TSSkeleton`).
struct SessionComparisonLoadingChart: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 260, cornerRadius: TSRadius.md)
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 4) { _ in
                    TSSkeleton(width: 56, height: 10)
                }
                Spacer(minLength: 0)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(SessionComparisonStrings.text("charging.curve.loading", "Loading session comparison"))
    }
}

// MARK: - Empty state (web empty merge → friendly state)

/// The resolved-but-empty state (web `comparisonSessions.length === 0` → bare chart),
/// rendered as a native `ContentUnavailableView` rather than a blank box.
struct SessionComparisonEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionComparisonStrings.text("charging.curve.emptyTitle", "No sessions to compare")
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            SessionComparisonStrings.text(
                "charging.curve.emptyHint",
                "Charging curves appear here once your vehicle completes a few charges."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`).
struct SessionComparisonError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SessionComparisonStrings.text("charging.curve.errorTitle", "Couldn't load session comparison")
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
                SessionComparisonStrings.text("charging.curve.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SessionComparisonStrings.text("charging.curve.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
