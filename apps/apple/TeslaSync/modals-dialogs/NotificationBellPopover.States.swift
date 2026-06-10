//
//  NotificationBellPopover.States.swift
//  TeslaSync — P4 modal / dialog · 0010 · NotificationBellPopover (Apple)
//
//  The composition sub-views `NotificationBellPopover` builds — the bell trigger + badge, the
//  popover panel (header + body + footer), and the always-on header / footer chrome. The per-row
//  entry, the severity dot, and the loading / empty / error / freshness leaf states live in
//  NotificationBellPopover.Rows.swift. Copy via P1/S10 (`NotificationBellStrings`); chrome via
//  P1/S9 tokens.
//

import SwiftUI

// MARK: - Trigger (web bell button + unread badge)

/// The header bell button with its unread-count badge (web trigger `<button>`). Tapping defers to
/// `onActivate` (the parent decides popover vs. inbox navigation by size class).
struct NotificationBellTrigger: View {
    @Bindable var model: NotificationBellModel
    let onActivate: () -> Void

    var body: some View {
        Button(action: onActivate) {
            Image(systemName: "bell")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 36, height: 36)
                .overlay(alignment: .topTrailing) { badge }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.triggerAccessibilityLabel))
    }

    @ViewBuilder
    private var badge: some View {
        if let text = model.badgeText {
            Text(verbatim: text)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .frame(minWidth: 16, minHeight: 16)
                .background(Color.TS.statusDanger, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.TS.surface, lineWidth: 1))
                .offset(x: 2, y: -2)
                .accessibilityHidden(true)
        }
    }
}

// MARK: - Panel (web popover dialog)

/// The triage panel presented in the popover: the always-on header, an optional cached-data banner,
/// the phase-switched body, and the always-on footer — clipped to the elevated surface with the
/// semantic border (web `surface-1` dialog card). Width tracks the web `POPOVER_WIDTH_PX` (360).
struct NotificationBellPanel: View {
    @Bindable var model: NotificationBellModel
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NotificationBellHeader(model: model, onClose: onClose)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.md)
            Divider().overlay(Color.TS.border)
            if model.connection != .live {
                NotificationBellConnectivityBanner(connection: model.connection)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.top, TSSpacing.sm)
            }
            NotificationBellBody(model: model, onNavigate: navigateToInbox)
            Divider().overlay(Color.TS.border)
            NotificationBellFooter(
                model: model,
                onMarkAllRead: { model.markAllRead() },
                onViewAll: navigateToInbox
            )
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
        }
        .frame(width: 360, alignment: .leading)
        .background(Color.TS.surface)
        .presentationCompactAdaptation(.popover)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: NotificationBellStrings.string(
            "notifications.bellPopover.title", "Notifications"
        )))
    }

    /// Web `navigateAndClose('/notifications/inbox')` — navigate, then dismiss the popover.
    private func navigateToInbox() {
        model.openInbox()
        onClose()
    }
}

// MARK: - Header (web dialog header)

/// The panel header: the "Notifications" title + the unread / all-caught-up subtitle, an optional
/// freshness chip, and the Close button (web header with `aria-labelledby` heading).
struct NotificationBellHeader: View {
    @Bindable var model: NotificationBellModel
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: NotificationBellStrings.string(
                    "notifications.bellPopover.title", "Notifications"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
                Text(verbatim: model.subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            if model.connection != .live {
                NotificationBellFreshnessChip(connection: model.connection)
            }
            closeButton
        }
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: NotificationBellStrings.string("common.close", "Close")))
    }
}

// MARK: - Body (web scrollable list region)

/// The scrollable panel body, switching over the resolved phase (web loading vs the list, widened
/// with empty + error so an opened popover is never blank). The populated branch surfaces the
/// inline reload error above the rows when cached rows survive a failed reload.
struct NotificationBellBody: View {
    @Bindable var model: NotificationBellModel
    let onNavigate: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                switch model.phase {
                case .loading:
                    NotificationBellLoadingState()
                case .empty:
                    NotificationBellEmptyState()
                case let .error(message):
                    NotificationBellErrorState(message: message) { model.refresh() }
                case .populated:
                    populated
                }
            }
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 360)
    }

    private var populated: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let message = model.inlineErrorMessage {
                NotificationBellInlineError(message: message)
                    .padding(.horizontal, TSSpacing.lg)
                    .padding(.vertical, TSSpacing.xs)
            }
            ForEach(model.entries) { entry in
                NotificationBellRow(entry: entry, model: model, onTap: onNavigate)
                if entry.id != model.entries.last?.id {
                    Divider().overlay(Color.TS.border).padding(.leading, TSSpacing.lg)
                }
            }
        }
    }
}

// MARK: - Footer (web dialog footer)

/// The always-on footer (web `<footer>`): "Mark all read" (disabled with no unread or while a mark
/// is pending) and the "View all" inbox escape hatch.
struct NotificationBellFooter: View {
    @Bindable var model: NotificationBellModel
    let onMarkAllRead: () -> Void
    let onViewAll: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onMarkAllRead) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .semibold))
                    Text(verbatim: NotificationBellStrings.string(
                        "notifications.bellPopover.markAllRead", "Mark all read"
                    ))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                }
                .foregroundStyle(model.markAllEnabled ? Color.TS.textSecondary : Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .disabled(!model.markAllEnabled)
            .accessibilityLabel(Text(verbatim: NotificationBellStrings.string(
                "notifications.bellPopover.markAllRead", "Mark all read"
            )))
            Spacer(minLength: TSSpacing.sm)
            Button(action: onViewAll) {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: NotificationBellStrings.string(
                        "notifications.bellPopover.viewAll", "View all"
                    ))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: NotificationBellStrings.string(
                "notifications.bellPopover.viewAll", "View all"
            )))
        }
    }
}
