//
//  ScheduledMaintenanceCard.Chrome.swift
//  TeslaSync — P4 feature view · 0251 · ScheduledMaintenanceCard (Apple)
//
//  The chrome composed by `ScheduledMaintenanceCard`: the header (icon + title + active / within-24h
//  chips + freshness chip + refresh), the stale / offline connectivity banner, the loading skeleton,
//  and the retryable error view. All consume the P1/S10 facade + the shared P1/S9 tokens — no
//  networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Header (web title row)

/// The card header — the native mirror of the web title row: the calendar icon (blue when active),
/// the "Scheduled maintenance" title, the "Maintenance active" badge + "Within 24h" chip, and the
/// trailing freshness chip + refresh affordance.
struct ScheduledMaintenanceHeader: View {
    let active: Bool
    let within24h: Bool
    let connection: ScheduledMaintenanceConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar.badge.clock")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(active ? Color.TS.statusInfo : Color.TS.textSecondary)
                .accessibilityHidden(true)
            Text(verbatim: ScheduledMaintenanceStrings.string("scheduled.title", "Scheduled maintenance"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if active { MaintenanceActiveBadge() }
            if within24h { MaintenanceWithin24hChip() }
            Spacer(minLength: TSSpacing.sm)
            ScheduledMaintenanceFreshnessChip(connection: connection)
            ScheduledMaintenanceRefreshButton(action: onRefresh)
        }
    }
}

// MARK: - Status chips (web Badge + within-24h note)

/// The "Maintenance active" badge (web `<Badge variant="info">`).
struct MaintenanceActiveBadge: View {
    var body: some View {
        let label = ScheduledMaintenanceStrings.string("scheduled.badge.active", "Maintenance active")
        return Text(verbatim: label)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusInfo)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusInfo.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusInfo.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }
}

/// The amber "Within 24h" pre-banner note (web amber `AlertTriangle` + label).
struct MaintenanceWithin24hChip: View {
    var body: some View {
        let label = ScheduledMaintenanceStrings.string("scheduled.within24h", "Within 24h")
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 9, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ScheduledMaintenanceFreshnessChip: View {
    let connection: ScheduledMaintenanceConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        let label = ScheduledMaintenanceStrings.string(descriptor.key, descriptor.fallback)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private static func descriptor(for connection: ScheduledMaintenanceConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "scheduled.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "scheduled.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "scheduled.offline", fallback: "Offline")
        }
    }
}

// MARK: - Refresh button (header)

/// The header refresh affordance — re-requests the maintenance snapshot (web `refetch()` peer).
struct ScheduledMaintenanceRefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: ScheduledMaintenanceStrings.string("scheduled.refresh", "Refresh")))
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the content when the bound source is not live, so the
/// cached maintenance state is clearly labeled while reconnecting / offline.
struct ScheduledMaintenanceConnectivityBanner: View {
    let connection: ScheduledMaintenanceConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "scheduled.offlineBanner" : "scheduled.staleBanner"
        let fallback = offline
            ? "Offline — showing last known maintenance state"
            : "Reconnecting — maintenance state may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: ScheduledMaintenanceStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading chrome (P4 leaf state)

/// The initial-fetch chrome: skeleton lines that keep the card shape while the maintenance row
/// resolves (web `isLoading && !state`).
struct ScheduledMaintenanceLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 220, height: 12)
            TSSkeleton(width: 160, height: 10)
            TSSkeleton(width: 130, height: 28, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(
            Text(verbatim: ScheduledMaintenanceStrings.string("scheduled.loadingA11y", "Loading maintenance state"))
        )
    }
}

// MARK: - Error chrome (web `QueryError` peer)

/// The fetch-failure state (P4 leaf addition over the web, which falls through to the scheduler)
/// with a retry affordance. Surfaces the failure message under the title when present.
struct ScheduledMaintenanceErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: ScheduledMaintenanceStrings.string(
                "scheduled.errorTitle",
                "Couldn't load maintenance state"
            ))
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
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: ScheduledMaintenanceStrings.string("scheduled.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: ScheduledMaintenanceStrings.string("scheduled.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
