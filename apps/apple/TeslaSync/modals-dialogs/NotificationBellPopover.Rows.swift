//
//  NotificationBellPopover.Rows.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The notification-row + leaf-state sub-views `NotificationBellPopover` composes (split from
//  NotificationBellPopover.States.swift for the lint file-length budget): the unread row, the
//  per-severity dot, the loading / empty / error / inline-error states, the freshness chip, and the
//  cached-data banner. Every state renders real chrome — never a blank box. Copy via P1/S10
//  (`NotificationBellStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Row (web bell-popover `<li>` button)

/// One unread row (web `logs.map` `<li><button>`): the severity dot, the title, the optional
/// one-line message, and the relative-time · vehicle meta line. Tapping navigates to the inbox.
struct NotificationBellRow: View {
    let entry: NotificationBellEntry
    @Bindable var model: NotificationBellModel
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                NotificationBellSeverityDot(severity: entry.severity)
                    .padding(.top, 5)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: model.entryTitle(entry))
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    if let message = entry.message, !message.isEmpty {
                        Text(verbatim: message)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                            .lineLimit(1)
                    }
                    metaLine
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(entry)))
        .accessibilityAddTraits(.isButton)
    }

    private var metaLine: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: model.relativeLabel(entry.createdAt))
            if let vehicle = entry.vehicleName, !vehicle.isEmpty {
                Text(verbatim: "·").accessibilityHidden(true)
                Text(verbatim: vehicle).lineLimit(1)
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .padding(.top, 1)
    }
}

// MARK: - Severity dot (web `SEVERITY_TONE` dot)

/// The per-severity leading dot (web `SEVERITY_TONE[sev].dot` + `.ring`): a toned circle with a
/// soft ring, mirroring the web sky / amber / rose tones.
struct NotificationBellSeverityDot: View {
    let severity: NotificationBellSeverity

    var body: some View {
        Circle()
            .fill(tone)
            .frame(width: 8, height: 8)
            .overlay(Circle().strokeBorder(tone.opacity(0.3), lineWidth: 3))
            .accessibilityHidden(true)
    }

    private var tone: Color {
        switch severity {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }
}

// MARK: - Loading (web Spinner row)

/// The first-paint loading line rendered inside the panel body (web `Loading…` status line).
struct NotificationBellLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
            Text(verbatim: NotificationBellStrings.string("notifications.bellPopover.loading", "Loading…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web "You're all caught up")

/// The resolved-but-no-unread state (web empty block), over a native `ContentUnavailableView` so
/// the panel is never a blank box (engineering guideline #6).
struct NotificationBellEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: NotificationBellStrings.string(
                    "notifications.bellPopover.emptyTitle", "You're all caught up"
                ))
            } icon: {
                Image(systemName: "bell.badge.slash")
            }
        } description: {
            Text(verbatim: NotificationBellStrings.string(
                "notifications.bellPopover.emptyMessage", "No unread notifications right now."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web error block with retry)

/// The fetch-failure state with a retry affordance (web error block), so a first-load failure with
/// no cached rows isn't a blank box.
struct NotificationBellErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: NotificationBellStrings.string(
                "notifications.bellPopover.error", "Could not load notifications"
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
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: NotificationBellStrings.string("notifications.bellPopover.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: NotificationBellStrings.string(
            "notifications.bellPopover.retry", "Retry"
        )))
    }
}

// MARK: - Inline error

/// The inline list-load error shown above the rows when a reload failed but cached rows remain.
struct NotificationBellInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: NotificationBellStrings.string(
                "notifications.bellPopover.error", "Could not load notifications"
            ))
            .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct NotificationBellFreshnessChip: View {
    let connection: NotificationBellConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            Text(verbatim: NotificationBellStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: NotificationBellStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: NotificationBellConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "notifications.bellPopover.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "notifications.bellPopover.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "notifications.bellPopover.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so a cached
/// preview is clearly labeled while reconnecting / offline (ADR-013).
struct NotificationBellConnectivityBanner: View {
    let connection: NotificationBellConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "notifications.bellPopover.offlineBanner" : "notifications.bellPopover.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded notifications"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: NotificationBellStrings.string(key, fallback))
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
