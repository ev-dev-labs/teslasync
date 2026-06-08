//
//  HealthGaugeGrid.States.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  The non-content chrome composed by `HealthGaugeGrid`: the live-state freshness chip, the
//  stale / offline connectivity banner, the initial-fetch loading grid, the empty state, and the
//  error state (the P4 states contract). All consume pre-localized strings from the P1/S10 facade
//  and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct HealthGaugeFreshnessChip: View {
    let connection: HealthGaugeConnection
    let isFetching: Bool
    let updatedAt: Date?

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var label: String {
        if isFetching {
            return HealthGaugeGridStrings.string("drivetrain.health.updating", "Updating")
        }
        switch connection {
        case .live: return HealthGaugeGridStrings.string("drivetrain.health.live", "Live")
        case .stale: return HealthGaugeGridStrings.string("drivetrain.health.stale", "Stale")
        case .offline: return HealthGaugeGridStrings.string("drivetrain.health.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the panels when the bound source is not live, so cached
/// values are clearly labeled.
struct HealthGaugeConnectivityBanner: View {
    let connection: HealthGaugeConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.health.offlineBanner" : "drivetrain.health.staleBanner"
        let fallback = offline
            ? "Offline — showing last known drivetrain health"
            : "Reconnecting — drivetrain health may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            HealthGaugeGridStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading grid (web `<Skeleton>` chrome)

/// The initial-fetch skeleton grid: three skeleton panels in the same responsive layout,
/// respecting Reduce Motion through the shared `TSSkeleton`.
struct HealthGaugeLoadingGrid: View {
    var body: some View {
        LazyVGrid(columns: HealthGaugeLayout.columns, alignment: .leading, spacing: TSSpacing.lg) {
            HealthGaugeGaugeSkeletonPanel()
            HealthGaugeKVSkeletonPanel()
            HealthGaugeKVSkeletonPanel()
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            HealthGaugeGridStrings.text("drivetrain.health.loading", "Loading drivetrain health")
        )
    }
}

/// The gauge-panel skeleton: a ring-shaped outline over a short label bar.
private struct HealthGaugeGaugeSkeletonPanel: View {
    var body: some View {
        HealthGaugePanel(alignment: .center) {
            Circle()
                .stroke(Color.TS.textMuted.opacity(0.22), lineWidth: 8)
                .frame(width: 140, height: 140)
            TSSkeleton(width: 80, height: 12)
            TSSkeleton(width: 140, height: 10)
        }
    }
}

/// A key/value-panel skeleton: a header bar over four redacted rows.
private struct HealthGaugeKVSkeletonPanel: View {
    var body: some View {
        HealthGaugePanel {
            TSSkeleton(width: 120, height: 12)
            HealthKVSkeleton(lines: 4)
        }
    }
}

/// `lines` redacted key/value rows (web `<Skeleton lines={4} />`).
struct HealthKVSkeleton: View {
    let lines: Int

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0 ..< max(0, lines), id: \.self) { index in
                if index > 0 {
                    Divider().overlay(Color.TS.border)
                }
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 96, height: 12)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 56, height: 12)
                }
                .padding(.vertical, TSSpacing.sm)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-no-data state: a friendly glyph plus a localized message, never a blank box.
struct HealthGaugeEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                HealthGaugeGridStrings.string("drivetrain.health.empty", "No drivetrain health data yet")
            ),
            systemImage: "gauge.with.dots.needle.bottom.50percent"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Error state (QueryError equivalent)

/// The failure state (the P4 states contract's `QueryError` equivalent): an icon, a title, the
/// optional message, and a retry affordance wired to the model's refresh.
struct HealthGaugeErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            HealthGaugeGridStrings.text("drivetrain.health.errorTitle", "Couldn't load drivetrain health")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                HealthGaugeGridStrings.text("drivetrain.health.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(HealthGaugeGridStrings.text("drivetrain.health.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
