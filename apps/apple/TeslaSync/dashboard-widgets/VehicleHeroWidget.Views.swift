//
//  VehicleHeroWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  The chrome subviews composed by `VehicleHeroWidget`: the status badge, the
//  freshness chip, the refresh button, the stale/offline connectivity banner, and
//  the loading / empty / error states. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Status badge (web `StatusBadge`)

/// A neutral pill with a colored state dot + capitalized state label — the native
/// port of the web `StatusBadge` (dot color from the FSM `badgeDot` override).
struct VehicleHeroWidgetStatusBadge: View {
    let status: VehicleHeroStatusVisual

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(status.dotColor)
                .frame(width: 8, height: 8)
            Text(verbatim: status.label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(Color.TS.surface, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: status.label))
    }
}

// MARK: - Freshness chip (web `FreshnessIndicator` / `DataFreshness`)

/// The live/stale/offline freshness chip shown in the header (web
/// `FreshnessIndicator`). The colored dot mirrors the connection lifecycle.
struct VehicleHeroFreshnessChip: View {
    let connection: VehicleHeroWidgetConnection
    let updatedAt: Date?

    var body: some View {
        let (tone, label) = descriptor
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var descriptor: (Color, String) {
        switch connection {
        case .live: (Color.TS.statusSuccess, VehicleHeroWidgetStrings.string("hero.live", "Live"))
        case .stale: (Color.TS.statusWarning, VehicleHeroWidgetStrings.string("hero.connStale", "Stale"))
        case .offline: (Color.TS.textMuted, VehicleHeroWidgetStrings.string("hero.connOffline", "Offline"))
        }
    }
}

// MARK: - Refresh button

/// The header refresh affordance (web `DataFreshness` `onRefresh`).
struct VehicleHeroRefreshButton: View {
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(VehicleHeroWidgetStrings.text("hero.refresh", "Refresh"))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not
/// live, so cached values are clearly labeled (web freshness-indicator intent).
struct VehicleHeroConnectivityBanner: View {
    let connection: VehicleHeroWidgetConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "hero.offlineBanner" : "hero.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known data"
            : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            VehicleHeroWidgetStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading chrome (web `Skeleton`)

/// The initial-fetch skeleton chrome (web `WidgetShell` `loading` → `<Skeleton>`).
/// Reduce-Motion is respected by `TSSkeleton`.
struct VehicleHeroLoadingChrome: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 150, height: 26, cornerRadius: TSRadius.sm)
                TSSkeleton(width: 64, height: 20, cornerRadius: TSRadius.pill)
                Spacer()
                TSSkeleton(width: 44, height: 14, cornerRadius: TSRadius.pill)
            }
            TSSkeleton(width: 200, height: 12)
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    TSSkeleton(width: 70, height: 70, cornerRadius: TSRadius.pill)
                }
            }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 2),
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(VehicleHeroWidgetStrings.text("hero.loading", "Loading vehicle"))
    }
}

// MARK: - Empty state (resolved, no vehicle)

/// The friendly empty state when the fleet resolves with no vehicle (the web shell
/// would otherwise hold a perpetual skeleton). Never a blank box.
struct VehicleHeroEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                VehicleHeroWidgetStrings.text("hero.emptyTitle", "No vehicle")
            } icon: {
                Image(systemName: "car.fill")
            }
        } description: {
            VehicleHeroWidgetStrings.text("hero.emptyHint", "Add a vehicle to see it here.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error state (web `QueryError`)

/// The fetch-failure state with a retry affordance (web `WidgetShell` `error` →
/// `<QueryError>`).
struct VehicleHeroErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            VehicleHeroWidgetStrings.text("hero.errorTitle", "Couldn't load vehicle")
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
                VehicleHeroWidgetStrings.text("hero.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleHeroWidgetStrings.text("hero.retry", "Retry"))
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}
