//
//  SessionList.States.swift
//  TeslaSync — P4 feature view · 0222 · SessionList (Apple)
//
//  The non-content states the sidebar switches over: the loading skeleton chrome (web
//  `isLoading` "Loading…" branch), the resolved-but-empty state (web `<EmptyState>`),
//  the page-owned fetch-error state with retry, and the live-state freshness chip +
//  cached-data banner (stale / offline). Every state renders a friendly surface —
//  never a blank box. Token-driven (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Loading state (web "Loading…" branch → skeleton chrome)

/// The initial-fetch chrome: muted skeleton rows under the localized "Loading…" label
/// (web shows the text; the native surface adds skeleton rows per the prompt).
struct ChatSessionLoadingState: View {
    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
            ChatSessionListStrings.text("common.loading", "Loading…")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .padding(.top, TSSpacing.xs)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(ChatSessionListStrings.text("common.loading", "Loading…"))
    }
}

// MARK: - Empty state (web `<EmptyState>` "No conversations yet")

/// The resolved-but-no-sessions state (web `<EmptyState icon=MessageSquare message="No
/// conversations yet">`) over a native `ContentUnavailableView`. Never a blank box.
struct ChatSessionEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                ChatSessionListStrings.text("chatbot.noSessions", "No conversations yet")
            } icon: {
                Image(systemName: "message")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (page-owned fetch failure with retry)

/// The fetch-failure state with a retry affordance — the page-owned envelope the web
/// controlled component leaves to its parent, surfaced here so the error state is
/// never a blank panel.
struct ChatSessionErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            ChatSessionListStrings.text("chatbot.sessions.errorTitle", "Couldn't load conversations")
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
                ChatSessionListStrings.text("chatbot.sessions.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChatSessionListStrings.text("chatbot.sessions.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown below the header when the bound source is not live, so
/// a cached list is clearly labeled (ADR-013 freshness).
struct ChatSessionConnectivityBanner: View {
    let connection: ChatSessionListConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "chatbot.sessions.offlineBanner" : "chatbot.sessions.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded conversations"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            ChatSessionListStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct ChatSessionFreshnessChip: View {
    let connection: ChatSessionListConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            ChatSessionListStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChatSessionListStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: ChatSessionListConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "chatbot.sessions.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "chatbot.sessions.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "chatbot.sessions.offline", fallback: "Offline")
        }
    }
}
