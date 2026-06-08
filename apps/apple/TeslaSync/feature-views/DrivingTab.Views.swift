//
//  DrivingTab.Views.swift
//  TeslaSync — P4 feature view · 0056 · DrivingTab (Apple)
//
//  The presentational chrome composed by `DrivingTab`: the glass section panel (web
//  `GlassPanel` + `SectionTitle`), the freshness chip, the stale/offline connectivity
//  banner, the per-chart empty row (web `EmptyState`), the initial-load skeleton, the
//  whole-surface empty state, and the shared error state (web `QueryError`). All consume
//  pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens — no
//  networking, no Tailwind ports. The seven chart panels live in `DrivingTab.Charts.swift`.
//

import SwiftUI

// MARK: - Section panel (web `GlassPanel` + `SectionTitle`)

/// A glass section card with a heading above its content, the native parity of the web
/// `<GlassPanel className="p-4">` wrapping a `<SectionTitle>`.
struct DriveAnalyticsPanel<Content: View>: View {
    let titleKey: String
    let titleFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            DrivingTabStrings.text(titleKey, titleFallback)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DriveAnalyticsFreshnessChip: View {
    let connection: DriveAnalyticsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrivingTabStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingTabStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DriveAnalyticsConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "analytics.driving.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "analytics.driving.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "analytics.driving.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the charts when the bound source is not live, so
/// cached charts are clearly labeled while reconnecting / offline (web `DataFreshness`).
struct DriveAnalyticsConnectivityBanner: View {
    let connection: DriveAnalyticsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.driving.offlineBanner" : "analytics.driving.staleBanner"
        let fallback = offline
            ? "Offline — showing last known driving analytics"
            : "Reconnecting — driving analytics may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DrivingTabStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Per-chart empty row (web `EmptyState`)

/// A centered, muted empty row a chart panel shows when its series is absent (web
/// `<EmptyState message=… />`). Sized so the panel never collapses to a blank box.
struct DriveAnalyticsEmptyRow: View {
    let key: String
    let fallback: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DrivingTabStrings.text(key, fallback)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingTabStrings.text(key, fallback))
    }
}

// MARK: - Initial-load skeleton (web `<Skeleton>`)

/// The initial-fetch skeleton chrome shown before the first payload, respecting Reduce
/// Motion (the skeleton shimmer is owned by `TSSkeleton`).
struct DriveAnalyticsLoadingPanels: View {
    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 180, height: 16)
                    TSSkeleton(height: 220)
                }
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(DrivingTabStrings.text("analytics.driving.loading", "Loading driving analytics"))
    }
}

// MARK: - Whole-surface empty state

/// The friendly, surface-level empty state shown when the analytics query resolved with no
/// drive data at all (never a blank region).
struct DriveAnalyticsSurfaceEmpty: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.2")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DrivingTabStrings.text("analytics.driving.emptyTitle", "No driving data yet")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            DrivingTabStrings.text(
                "analytics.driving.emptyMessage",
                "Drive analytics appear here once your vehicles report trips."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (web `QueryError`)

/// The whole-surface error state with a retry affordance (web `QueryError`), shown when the
/// analytics query failed and there is no cached payload to keep on screen.
struct DriveAnalyticsErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DrivingTabStrings.text("analytics.driving.errorTitle", "Couldn't load driving analytics")
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
                DrivingTabStrings.text("analytics.driving.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DrivingTabStrings.text("analytics.driving.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(TSSpacing.lg)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
