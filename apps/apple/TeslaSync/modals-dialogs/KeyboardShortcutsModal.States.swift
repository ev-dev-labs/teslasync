//
//  KeyboardShortcutsModal.States.swift
//  TeslaSync — P4 modal/dialog · 0006 · KeyboardShortcutsModal (Apple)
//
//  The non-content states `KeyboardShortcutsModal` switches over — loading (web Spinner equivalent),
//  empty (the web "No shortcuts match your search." line), error (web `QueryError` with retry) — plus
//  the live-state freshness chip + cached-data banner. Every state renders real chrome — never a blank
//  box. Copy via P1/S10; chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web Spinner)

/// The first-paint loading state rendered under the controls, so the layout doesn't reflow when the
/// registry snapshot resolves.
struct KBShortcutLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            KBShortcutsStrings.text("shortcuts.state.loading", "Loading shortcuts…")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web "No shortcuts match your search.")

/// The resolved-but-no-rows state over a native `ContentUnavailableView` (never a blank box). Covers both
/// "no shortcuts registered" and "no shortcuts match the active filter + search" — the web's single
/// empty line.
struct KBShortcutEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - Error (web `QueryError` with retry)

/// The load-failure state with a retry affordance (web `QueryError` — a first-resolve failure rendered as
/// a panel with a retry, never a blank box).
struct KBShortcutErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            KBShortcutsStrings.text("shortcuts.state.error", "Couldn't load shortcuts.")
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
            KBShortcutsStrings.text("shortcuts.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(KBShortcutsStrings.text("shortcuts.retry", "Retry"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct KBShortcutFreshnessChip: View {
    let connection: KBShortcutsConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            KBShortcutsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(KBShortcutsStrings.text(descriptor.key, descriptor.fallback))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: KBShortcutsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "shortcuts.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "shortcuts.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "shortcuts.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the controls when the bound source is not live, so the user knows
/// the shortcut list may be momentarily out of date (ADR-013).
struct KBShortcutConnectivityBanner: View {
    let connection: KBShortcutsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "shortcuts.offlineBanner" : "shortcuts.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded shortcuts"
            : "Reconnecting — the shortcut list may be momentarily out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            KBShortcutsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
