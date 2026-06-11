//
//  RequiresAuth.States.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The non-content states the RequiresAuth lock notice switches over — loading (initial
//  `/system/auth-mode` poll), error (poll failed → retry, the native peer of the web `QueryError`),
//  plus the live-state freshness chip + cached-data banner so a gate decision driven by a cached
//  contract read is clearly labelled (ADR-013). Every state renders real chrome — never a blank box.
//  Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (initial contract poll)

/// The first-paint loading chrome (web renders the lock notice while the contract loads — here a
/// dedicated spinner state so the section never flashes its children and the layout doesn't reflow).
struct RequiresAuthLoadingState: View {
    let label: String

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            ProgressView()
                .controlSize(.regular)
            Text(verbatim: label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Error (web `QueryError` peer with retry)

/// The contract-failure chrome with a retry affordance (web `QueryError`), so a first-load failure
/// with no cached snapshot isn't a blank box.
struct RequiresAuthErrorState: View {
    let title: String
    let message: String
    let retryLabel: String
    let accessibilityLabel: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: title)
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
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: retryLabel)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: retryLabel))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013), shown in the lock notice
/// header.
struct RequiresAuthFreshnessChip: View {
    let connection: RequiresAuthConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            RequiresAuthStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(RequiresAuthStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: RequiresAuthConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "requiresAuth.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "requiresAuth.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "requiresAuth.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the lock notice body when the bound source is not live, so a
/// gate decision driven by a cached contract read is clearly labelled (ADR-013).
struct RequiresAuthConnectivityBanner: View {
    let connection: RequiresAuthConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "requiresAuth.offlineBanner" : "requiresAuth.staleBanner"
        let fallback = offline
            ? "Offline — showing the last known access mode"
            : "Reconnecting — this access mode may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            RequiresAuthStrings.text(key, fallback)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Localization Text helper

extension RequiresAuthStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
