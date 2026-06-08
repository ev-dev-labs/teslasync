//
//  InboxBody.Rows.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The inbox list + the single notification row (web `NotificationRow`). The list
//  renders the flat day-grouped rows (web `groupByDay` → headers + `SwipeRow`s) or
//  the grouped threads (web `NotificationGroupRow`). Each row shows the selection
//  checkbox, the severity chip, the relative time, the vehicle / rule context, the
//  title (bold when unread) + message, and exposes the full per-row action set via
//  a trailing menu + a long-press context menu (web quick buttons + `onContextMenu`
//  + `SwipeRow`). Tapping the body marks an unread row read (web `onActivate`).
//

import SwiftUI

// MARK: - List (web flat day-grouped list / grouped thread list)

/// Switches between the flat day-grouped list and the grouped thread list.
struct InboxListView: View {
    @Bindable var model: InboxBodyModel

    var body: some View {
        if model.isGrouped {
            groupedList
        } else {
            flatList
        }
    }

    private var flatList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(model.dayGroups) { group in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    InboxDayHeader(bucket: group.bucket, localize: model.localize)
                    ForEach(group.rows) { notification in
                        InboxNotificationRowView(model: model, notification: notification)
                    }
                }
            }
        }
    }

    private var groupedList: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(model.groups) { group in
                InboxGroupRowView(model: model, group: group)
            }
        }
    }
}

// MARK: - Notification row (web `NotificationRow`)

/// One inbox row (web `NotificationRow`): selection checkbox · severity chip ·
/// time · vehicle / rule context · title · message, with the per-row action menu.
struct InboxNotificationRowView: View {
    @Bindable var model: InboxBodyModel
    let notification: InboxNotification

    private var severity: InboxSeverity {
        model.severity(for: notification)
    }

    private var isUnread: Bool {
        !notification.isRead
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            checkbox
            mainColumn
            Spacer(minLength: TSSpacing.xs)
            InboxRowMenu(model: model, notification: notification)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(rowBackground)
        .overlay(alignment: .leading) {
            if isUnread {
                Rectangle()
                    .fill(Color.TS.accent.opacity(0.7))
                    .frame(width: 2)
                    .accessibilityHidden(true)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .contextMenu { InboxRowMenuItems(model: model, notification: notification) }
        .accessibilityElement(children: .contain)
    }

    private var rowBackground: some View {
        isUnread ? Color.TS.surfaceGlass : Color.clear
    }

    private var checkbox: some View {
        Button {
            model.toggleSelected(notification.id, !model.isSelected(notification.id))
        } label: {
            Image(systemName: model.isSelected(notification.id) ? "checkmark.square.fill" : "square")
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(model.isSelected(notification.id) ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .padding(.top, 1)
        .accessibilityLabel(Text(verbatim: model.localize("notifications.inbox.row.select", "Select notification")))
        .accessibilityAddTraits(model.isSelected(notification.id) ? .isSelected : [])
    }

    private var mainColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            metaRow
            Text(verbatim: notification.title)
                .font(Font.TS.bodySm)
                .fontWeight(isUnread ? .semibold : .regular)
                .foregroundStyle(isUnread ? Color.TS.textPrimary : Color.TS.textSecondary)
                .lineLimit(1)
            if !notification.message.isEmpty {
                Text(verbatim: notification.message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { model.handleRowActivate(notification) }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(Text(verbatim: model.rowAccessibility(for: notification)))
    }

    private var metaRow: some View {
        HStack(spacing: TSSpacing.xs) {
            InboxSeverityChip(severity: severity, localize: model.localize)
            Text(verbatim: model.relativeTime(for: notification))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            if let vehicle = model.vehicle(for: notification) {
                metaDetail("· \(vehicle.label)")
            }
            if let name = model.rule(for: notification)?.name, !name.isEmpty {
                metaDetail("· \(name)")
            }
        }
    }

    private func metaDetail(_ text: String) -> some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

// MARK: - Severity chip (web `SeverityBadge`)

/// The severity chip — a short severity word inside a tinted capsule (the toned
/// chip exception): icon + label on a `tint`/10 background with a `tint`/20 border.
struct InboxSeverityChip: View {
    let severity: InboxSeverity
    let localize: (String, String) -> String

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: severity.symbolName)
                .font(.system(size: 9, weight: .bold))
            Text(verbatim: localize(severity.labelKey, severity.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(severity.tint)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 1)
        .background(severity.tint.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(severity.tint.opacity(0.25), lineWidth: 1))
        .accessibilityHidden(true)
    }
}
