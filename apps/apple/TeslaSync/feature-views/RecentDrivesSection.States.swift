//
//  RecentDrivesSection.States.swift
//  TeslaSync — P4 feature view · 0297 · RecentDrivesSection (Apple)
//
//  The non-content states `RecentDrivesSection` switches over — loading (web Spinner), empty
//  (web `EmptyState` "No drives recorded yet"), error (web `QueryError` with retry), the inline
//  reload error, and the live-state freshness chip + cached-data banner. Every state renders
//  real chrome — never a blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the header (web `<Spinner/>`), so the layout
/// doesn't reflow when the rows arrive.
struct RecentDrivesLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            RecentDrivesStrings.text("recentDrives.loading", "Loading drives…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web `EmptyState` "No drives recorded yet")

/// The resolved-but-no-drives state (web `<EmptyState icon={Route} message="No drives recorded
/// yet" />`) over a native `ContentUnavailableView`. Never a blank box.
struct RecentDrivesEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                RecentDrivesStrings.text("common.noDrives", "No drives recorded yet")
            } icon: {
                Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct RecentDrivesErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            RecentDrivesStrings.text("recentDrives.errors.load", "Failed to load drives.")
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            RecentDrivesStrings.text("recentDrives.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(RecentDrivesStrings.text("recentDrives.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-rows-with-failure)

/// The inline reload error shown above the populated rows when a refresh failed but cached rows
/// remain (web reload-failure-with-cached-data).
struct RecentDrivesInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            RecentDrivesStrings.text("recentDrives.errors.load", "Failed to load drives.")
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct RecentDrivesFreshnessChip: View {
    let connection: RecentDrivesConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            RecentDrivesStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(RecentDrivesStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: RecentDrivesConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "recentDrives.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "recentDrives.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "recentDrives.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so a
/// cached list is clearly labeled (ADR-013).
struct RecentDrivesConnectivityBanner: View {
    let connection: RecentDrivesConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "recentDrives.offlineBanner" : "recentDrives.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded drives"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            RecentDrivesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
