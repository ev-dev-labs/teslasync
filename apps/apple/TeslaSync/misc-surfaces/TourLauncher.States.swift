//
//  TourLauncher.States.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The non-content states `TourLauncher` switches over — loading (web Spinner), empty (resolved
//  with no tours), error (web `QueryError` with retry), the inline reload error, and the
//  live-state freshness chip + cached-data banner. Every state renders real chrome — never a
//  blank box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the header (web `<Spinner/>`), so the layout
/// doesn't reflow when the registry resolves.
struct TourLauncherLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            TourLauncherStrings.text("tourLauncher.loading", "Loading tours…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no tours)

/// The resolved-but-no-tours state over a native `ContentUnavailableView` (never a blank box).
/// The web registry always has tours; this guards the empty-registry edge so the surface always
/// renders something friendly.
struct TourLauncherEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TourLauncherStrings.text("tourLauncher.empty", "No tours available")
            } icon: {
                Image(systemName: "map")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-load failure
/// rendered as a panel with a retry, never a blank box).
struct TourLauncherErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TourLauncherStrings.text("tourLauncher.errors.load", "Failed to load tours.")
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
            TourLauncherStrings.text("tourLauncher.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TourLauncherStrings.text("tourLauncher.retry", "Retry"))
    }
}

// MARK: - Inline reload error (web cached-rows-with-failure)

/// The inline reload error shown above the populated list when a refresh failed but cached rows
/// remain (web reload-failure-with-cached-data).
struct TourLauncherInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            TourLauncherStrings.text("tourLauncher.errors.load", "Failed to load tours.")
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
struct TourLauncherFreshnessChip: View {
    let connection: TourLauncherConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TourLauncherStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TourLauncherStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: TourLauncherConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "tourLauncher.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "tourLauncher.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "tourLauncher.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the content when the bound source is not live, so cached
/// tour progress is clearly labeled (ADR-013).
struct TourLauncherConnectivityBanner: View {
    let connection: TourLauncherConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "tourLauncher.offlineBanner" : "tourLauncher.staleBanner"
        let fallback = offline
            ? "Offline — showing your last synced tour progress"
            : "Reconnecting — your tour progress may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TourLauncherStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
