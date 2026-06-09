//
//  HealthOverview.States.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  The non-content chrome composed by `HealthOverview`: the live-state freshness chip, the
//  stale / offline connectivity banner, the initial-fetch loading skeleton, the empty state, and
//  the error state (the P4 states contract). All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct HealthOverviewFreshnessChip: View {
    let connection: HealthOverviewConnection
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
            return HealthOverviewStrings.string("drivetrain.healthOverview.updating", "Updating")
        }
        switch connection {
        case .live: return HealthOverviewStrings.string("drivetrain.healthOverview.live", "Live")
        case .stale: return HealthOverviewStrings.string("drivetrain.healthOverview.stale", "Stale")
        case .offline: return HealthOverviewStrings.string("drivetrain.healthOverview.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the card when the bound source is not live, so the cached
/// summary is clearly labeled.
struct HealthOverviewConnectivityBanner: View {
    let connection: HealthOverviewConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.healthOverview.offlineBanner" : "drivetrain.healthOverview.staleBanner"
        let fallback = offline
            ? "Offline — showing last known drivetrain health"
            : "Reconnecting — drivetrain health may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            HealthOverviewStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web `<Skeleton>` chrome)

/// The initial-fetch skeleton: a glass card echoing the summary-card layout (a circular icon
/// outline + two text bars on the leading edge, a chip + value bar on the trailing edge),
/// respecting Reduce Motion through the shared `TSSkeleton`.
struct HealthOverviewLoadingState: View {
    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.lg) {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                Circle()
                    .fill(Color.TS.textMuted.opacity(0.18))
                    .frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 180, height: 16)
                    TSSkeleton(width: 120, height: 12)
                }
            }
            Spacer(minLength: TSSpacing.md)
            HStack(spacing: TSSpacing.md) {
                TSSkeleton(width: 72, height: 22)
                TSSkeleton(width: 56, height: 24)
            }
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            HealthOverviewStrings.text("drivetrain.healthOverview.loading", "Loading drivetrain health")
        )
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-no-data state: a friendly glyph plus a localized message, never a blank box.
struct HealthOverviewEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                HealthOverviewStrings.string("drivetrain.healthOverview.empty", "No drivetrain health data yet")
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
struct HealthOverviewErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            HealthOverviewStrings.text("drivetrain.healthOverview.errorTitle", "Couldn't load drivetrain health")
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
                HealthOverviewStrings.text("drivetrain.healthOverview.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(HealthOverviewStrings.text("drivetrain.healthOverview.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
