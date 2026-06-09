//
//  HealthRecommendations.States.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  The non-content chrome composed by `HealthRecommendations`: the live-state freshness chip, the
//  stale / offline connectivity banner, the initial-fetch loading skeleton, the empty state, and the
//  error state (the P4 states contract). All consume pre-localized strings from the P1/S10 facade and
//  the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline / Updating)

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a tinted dot, a
/// localized label, and an optional relative "updated" stamp.
struct HealthRecommendationsFreshnessChip: View {
    let connection: HealthRecommendationsConnection
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
            return HealthRecommendationsStrings.string("drivetrain.healthRecommendations.updating", "Updating")
        }
        switch connection {
        case .live: return HealthRecommendationsStrings.string("drivetrain.healthRecommendations.live", "Live")
        case .stale: return HealthRecommendationsStrings.string("drivetrain.healthRecommendations.stale", "Stale")
        case .offline: return HealthRecommendationsStrings.string("drivetrain.healthRecommendations.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the panel when the bound source is not live, so the cached
/// recommendations are clearly labeled.
struct HealthRecommendationsConnectivityBanner: View {
    let connection: HealthRecommendationsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline
            ? "drivetrain.healthRecommendations.offlineBanner"
            : "drivetrain.healthRecommendations.staleBanner"
        let fallback = offline
            ? "Offline — showing last known recommendations"
            : "Reconnecting — drivetrain recommendations may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            HealthRecommendationsStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton: a glass panel echoing the recommendations layout (a small header glyph
/// + title bar over a few tip-card outlines), respecting Reduce Motion through the shared
/// `TSSkeleton`.
struct HealthRecommendationsLoadingState: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.sm) {
                Circle()
                    .fill(Color.TS.textMuted.opacity(0.18))
                    .frame(width: 18, height: 18)
                TSSkeleton(width: 180, height: 14)
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 44)
                }
            }
        }
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel(
            HealthRecommendationsStrings.text("drivetrain.healthRecommendations.loading", "Loading recommendations")
        )
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The resolved-but-no-data state: a friendly glyph plus a localized message, never a blank box.
struct HealthRecommendationsEmptyState: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                HealthRecommendationsStrings.string(
                    "drivetrain.healthRecommendations.empty",
                    "No recommendations available yet"
                )
            ),
            systemImage: "checklist"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Error state (QueryError equivalent)

/// The failure state (the P4 states contract's `QueryError` equivalent): an icon, a title, the
/// optional message, and a retry affordance wired to the model's refresh.
struct HealthRecommendationsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            HealthRecommendationsStrings
                .text("drivetrain.healthRecommendations.errorTitle", "Couldn't load recommendations")
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
                HealthRecommendationsStrings.text("drivetrain.healthRecommendations.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(HealthRecommendationsStrings.text("drivetrain.healthRecommendations.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
