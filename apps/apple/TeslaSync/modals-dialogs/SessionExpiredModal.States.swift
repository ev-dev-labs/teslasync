//
//  SessionExpiredModal.States.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The non-content states `SessionExpiredModal` switches over — loading (skeleton chrome), empty
//  (open mode: no session to protect), dormant (session healthy: the web hidden-modal branch shown
//  as a friendly surface), error (poll failed → retry), and the live-state freshness chip +
//  connectivity banner. Every state renders real chrome — never a blank box. Copy via P1/S10;
//  chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (skeleton chrome)

/// The first-poll loading state: a redaction-free skeleton of the block (icon disc, title + body
/// bars, action bar) so the layout doesn't reflow when the session verdict resolves. A gentle
/// opacity pulse runs unless Reduce Motion is on.
struct SessionExpiredLoadingState: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            Circle()
                .fill(Color.TS.surfaceGlass)
                .frame(width: 48, height: 48)
            VStack(spacing: TSSpacing.sm) {
                bar(width: 150, height: 16)
                VStack(spacing: TSSpacing.xs) {
                    bar(width: nil, height: 11)
                    bar(width: 210, height: 11)
                }
            }
            bar(width: nil, height: 44)
        }
        .frame(maxWidth: .infinity)
        .opacity(pulsing ? 0.55 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SessionExpiredStrings.string("session.expired.loading", "Checking your session…"))
    }

    private func bar(width: CGFloat?, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.textMuted.opacity(0.18))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
    }
}

// MARK: - Empty (open mode: no session to protect)

/// The open-mode state (web `mode === 'open' → return null`) rendered as a friendly
/// `ContentUnavailableView` rather than nothing, so the surface never shows a blank box when it is
/// inspected directly.
struct SessionExpiredEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                SessionExpiredStrings.text("session.expired.openTitle", "No sign-in required")
            } icon: {
                Image(systemName: "lock.open")
            }
        } description: {
            SessionExpiredStrings.text(
                "session.expired.openBody",
                "This deployment has no session to expire."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Dormant (session healthy: web hidden-modal branch)

/// The healthy-session state (web Modal `open=false` — nothing shown). Surfaced as a calm,
/// reassuring panel rather than an empty view so the always-mounted surface reads clearly when not
/// blocking.
struct SessionExpiredDormantState: View {
    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 32))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            SessionExpiredStrings.text("session.expired.activeTitle", "Session active")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            SessionExpiredStrings.text(
                "session.expired.activeBody",
                "You're signed in. We'll let you know if your session is about to expire."
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The poll-failure state with a retry affordance (web `QueryError` — a first-load failure rendered
/// as a panel with a retry, never a blank box).
struct SessionExpiredErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            SessionExpiredStrings.text("session.expired.errorTitle", "Couldn't check your session")
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
            SessionExpiredStrings.text("session.expired.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SessionExpiredStrings.text("session.expired.retry", "Retry"))
    }
}

// MARK: - Freshness chip (Stale / Offline)

/// The freshness chip reflecting the bound source's live-state (ADR-013). The live read needs no
/// chip (web has none); the parent renders this only for the stale / offline reads.
struct SessionExpiredFreshnessChip: View {
    let connection: SessionConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            SessionExpiredStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(SessionExpiredStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: SessionConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "session.expired.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "session.expired.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "session.expired.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-verdict banner shown above the content when the bound source is not live, so the user
/// knows the session verdict may be re-checked once connectivity returns (ADR-013).
struct SessionExpiredConnectivityBanner: View {
    let connection: SessionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "session.expired.offlineBanner" : "session.expired.staleBanner"
        let fallback = offline
            ? "Offline — reconnect to verify your session"
            : "Reconnecting — re-checking your session"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            SessionExpiredStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
