//
//  EntryDrawer.States.swift
//  TeslaSync — P4 modal / dialog · 0018 · EntryDrawer (Apple)
//
//  The non-content leaf states `EntryDrawer` switches over — loading (the full-entry fetch, web
//  `loading && !full` spinner), empty (resolved with no entry → friendly hint), error (the full
//  fetch failed with no cached head → retry), the inline reload error (a cached head survives a
//  failed reload), and the live-state freshness chip + cached-data banner. Every state renders real
//  chrome — never a blank box. Copy via P1/S10 (`EntryDrawerStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web `loading && !full` spinner)

/// The full-entry loading state — the parity of the web `<Spinner />` shown while the payload
/// lazy-loads.
struct EntryDrawerLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView().controlSize(.small)
            Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.loading", "Loading entry…"))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (resolved with no entry)

/// The resolved-but-no-entry hint (web returns `null`; the Apple modal renders a friendly empty
/// state rather than a blank box).
struct EntryDrawerEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.emptyTitle", "No entry selected"))
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            Text(verbatim: EntryDrawerStrings.string(
                "admin.dlq.drawer.emptyMessage",
                "Pick a dead-letter entry to inspect its payload."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (full fetch failed, no cached head → retry)

/// The load-failure state with a retry affordance (web has none — a first-load failure rendered as
/// a panel with a retry, never a blank box).
struct EntryDrawerErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.errorTitle", "Couldn't load this entry"))
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
            Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.retry", "Retry")))
    }
}

// MARK: - Inline reload error (cached head survives a failed reload)

/// The inline reload error shown above the panels when a refresh failed but a cached head remains
/// (web has none — the Apple cached-data-with-failure affordance).
struct EntryDrawerInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: EntryDrawerStrings.string("admin.dlq.drawer.reloadFailed", "Couldn't refresh this entry"))
                .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message).font(Font.TS.caption).lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.statusDanger.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct EntryDrawerFreshnessChip: View {
    let connection: EntryDrawerConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            Text(verbatim: EntryDrawerStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: EntryDrawerStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: EntryDrawerConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "admin.dlq.drawer.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "admin.dlq.drawer.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "admin.dlq.drawer.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so the operator
/// knows the entry may be out of date (ADR-013).
struct EntryDrawerConnectivityBanner: View {
    let connection: EntryDrawerConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "admin.dlq.drawer.offlineBanner" : "admin.dlq.drawer.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded entry"
            : "Reconnecting — this entry may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: EntryDrawerStrings.string(key, fallback)).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
