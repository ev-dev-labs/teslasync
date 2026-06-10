//
//  GeofenceDrawer.States.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The non-content states `GeofenceDrawer` switches over — loading (first fetch), empty (resolved
//  with no fences yet, shown beneath a live map + toolbar so the first fence is still drawable),
//  error (load failed → retry), the inline reload error, and the live-state freshness chip +
//  cached-data banner. Every state renders real chrome — never a blank box. Copy via P1/S10; chrome
//  via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (first fetch)

/// The first-paint loading state (web has none — added per the Apple modal contract), so the layout
/// doesn't reflow when the fences resolve.
struct GeofenceLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            GeofenceDrawerStrings.text("geofence.loading", "Loading geofences…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no fences)

/// The resolved-but-no-fences hint shown in the list region (never a blank box). The map + toolbar
/// stay live above it, so the user can draw the first fence immediately.
struct GeofenceEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                GeofenceDrawerStrings.text("geofence.empty.title", "No geofences yet")
            } icon: {
                Image(systemName: "mappin.slash")
            }
        } description: {
            GeofenceDrawerStrings.text("geofence.empty.message", "Pick a shape and tap the map to draw one.")
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (load failed → retry)

/// The load-failure state with a retry affordance (web has none — a first-load failure rendered as
/// a panel with a retry, never a blank box).
struct GeofenceErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            GeofenceDrawerStrings.text("geofence.errors.load", "Couldn't load geofences.")
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
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            GeofenceDrawerStrings.text("geofence.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(GeofenceDrawerStrings.text("geofence.retry", "Retry"))
    }
}

// MARK: - Inline reload error (cached snapshot survives a failed reload)

/// The inline reload error shown above the live surface when a refresh failed but a cached snapshot
/// remains (web has none — the Apple cached-data-with-failure affordance).
struct GeofenceInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            GeofenceDrawerStrings.text("geofence.errors.load", "Couldn't load geofences.")
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
struct GeofenceFreshnessChip: View {
    let connection: GeofenceDrawerConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            GeofenceDrawerStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(GeofenceDrawerStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: GeofenceDrawerConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "geofence.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "geofence.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "geofence.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the surface when the bound source is not live, so the user
/// knows a saved fence may not have synced yet (ADR-013).
struct GeofenceConnectivityBanner: View {
    let connection: GeofenceDrawerConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "geofence.offlineBanner" : "geofence.staleBanner"
        let fallback = offline
            ? "Offline — geofence changes will sync when you reconnect"
            : "Reconnecting — geofence changes may not be saved yet"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            GeofenceDrawerStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
