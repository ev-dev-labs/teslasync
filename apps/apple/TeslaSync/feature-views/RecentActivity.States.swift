//
//  RecentActivity.States.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  The surface-envelope chrome for "Recent Activity": the live-state freshness chip, the
//  stale/offline connectivity banner, and the surface-level loading / empty / error states the
//  bound model switches over. Kept beside RecentActivity.Views.swift (the panels) so each file
//  owns one concern. All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No networking lives here.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// A compact freshness chip reflecting the bound source's live-state (ADR-013). Shown only when
/// the surface is not live, so the healthy state stays as visually clean as the web source.
struct RecentActivityFreshnessChip: View {
    let connection: RecentActivityConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            RecentActivityStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(RecentActivityStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: RecentActivityConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "activity.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "activity.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "activity.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the panels when the bound source is not live, so cached
/// data is clearly labeled while reconnecting / offline.
struct RecentActivityConnectivityBanner: View {
    let connection: RecentActivityConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "activity.offlineBanner" : "activity.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known activity"
            : "Reconnecting — recent activity may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            RecentActivityStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading state (web `Skeleton`)

/// The initial-fetch skeleton chrome: the three panels redacted (web `Skeleton`), reduce-motion
/// safe via the shared `TSSkeleton`.
struct RecentActivityLoading: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            RecentActivityGlassPanel {
                TSSkeleton(width: 140, height: 16)
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(alignment: .top, spacing: TSSpacing.md) {
                        TSSkeleton(width: 28, height: 28, cornerRadius: 14)
                        VStack(alignment: .leading, spacing: TSSpacing.xs) {
                            TSSkeleton(width: 150, height: 12)
                            TSSkeleton(width: 110, height: 10)
                        }
                        Spacer(minLength: TSSpacing.sm)
                        TSSkeleton(width: 40, height: 10)
                    }
                }
            }
            RecentActivityGlassPanel {
                TSSkeleton(width: 120, height: 16)
                TSChartSkeleton(height: 160)
            }
            RecentActivityGlassPanel {
                TSSkeleton(width: 140, height: 16)
                ForEach(0 ..< 4, id: \.self) { _ in
                    HStack {
                        TSSkeleton(width: 120, height: 11)
                        Spacer(minLength: TSSpacing.md)
                        TSSkeleton(width: 56, height: 12)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(RecentActivityStrings.text("activity.loading", "Loading recent activity"))
    }
}

// MARK: - Empty state (web friendly empty)

/// The resolved-but-empty surface (every panel empty): a friendly `ContentUnavailableView`. Never
/// a blank box.
struct RecentActivityEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                RecentActivityStrings.text("activity.empty", "No activity yet. Start driving!")
            } icon: {
                Image(systemName: "clock.badge.questionmark")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct RecentActivityError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            RecentActivityStrings.text("activity.errorTitle", "Couldn't load recent activity")
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
                RecentActivityStrings.text("activity.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(RecentActivityStrings.text("activity.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
