//
//  RecentActivity.Vehicles.States.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  The surface-envelope chrome for the vehicles "Recent Activity": the live-state freshness chip,
//  the stale/offline connectivity banner, and the surface-level loading / empty / error states the
//  bound model switches over. Kept beside RecentActivity.Vehicles.Views.swift (the panels) so each
//  file owns one concern. All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No networking lives here.
//

import SwiftUI

// MARK: - Freshness chip (Live / Stale / Offline)

/// A compact freshness chip reflecting the bound source's live-state (ADR-013). Shown only when the
/// surface is not live, so the healthy state stays as visually clean as the web source.
struct VehicleRecentActivityFreshnessChip: View {
    let connection: VehicleRecentActivityConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            VehicleRecentActivityStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(VehicleRecentActivityStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: VehicleRecentActivityConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "activity.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "activity.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "activity.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the panels when the bound source is not live, so cached data
/// is clearly labeled while reconnecting / offline.
struct VehicleRecentActivityConnectivityBanner: View {
    let connection: VehicleRecentActivityConnection

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
            VehicleRecentActivityStrings.text(key, fallback).font(Font.TS.caption)
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

/// The initial-fetch skeleton chrome: the two panels redacted (web `Skeleton`), reduce-motion safe
/// via the shared `TSSkeleton`.
struct VehicleRecentActivityLoading: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                VStack(spacing: TSSpacing.lg) {
                    panel
                    panel
                }
            } else {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    panel
                    panel
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(VehicleRecentActivityStrings.text("activity.loading", "Loading recent activity"))
    }

    private var panel: some View {
        VehicleRecentActivityGlassPanel {
            TSSkeleton(width: 140, height: 16)
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 32, height: 32, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 90, height: 12)
                        TSSkeleton(width: 70, height: 10)
                    }
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 52, height: 11)
                }
            }
        }
    }
}

// MARK: - Empty state (web friendly empty)

/// The resolved-but-empty surface (both panels empty): a friendly `ContentUnavailableView`. Never a
/// blank box.
struct VehicleRecentActivityEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                VehicleRecentActivityStrings.text("activity.empty", "No recent activity")
            } icon: {
                Image(systemName: "car.side.and.exclamationmark")
            }
        } description: {
            VehicleRecentActivityStrings.text("activity.emptyHint", "Recent drives and charges will appear here")
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct VehicleRecentActivityError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VehicleRecentActivityStrings.text("activity.errorTitle", "Couldn't load recent activity")
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
                VehicleRecentActivityStrings.text("activity.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleRecentActivityStrings.text("activity.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
