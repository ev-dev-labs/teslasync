//
//  InboxBody.Group.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The grouped notification thread (web `NotificationGroupRow`): the latest member
//  rendered identically to a flat row, plus the grouping affordances — the
//  "+N similar" expand chip, the unread-count badge, the affected-vehicle count,
//  and the "Mark group read" action — and the expandable member list. Singletons
//  (groupKey == nil) render as a plain row with the grouping chrome hidden.
//  Strings come from the P1/S10 facade; colours from the shared P1/S9 tokens.
//

import SwiftUI

struct InboxGroupRowView: View {
    @Bindable var model: InboxBodyModel
    let group: InboxGroup
    @State private var expanded = false

    private var showsChips: Bool {
        !group.isSingleton && (group.extraCount > 0 || group.unreadCount > 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            InboxNotificationRowView(model: model, notification: group.latest)
            if showsChips {
                chipRow
            }
            if expanded, !group.isSingleton {
                membersRegion
            }
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: Chips (web "+N similar" · unread badge · vehicles affected · mark read)

    private var chipRow: some View {
        HStack(spacing: TSSpacing.xs) {
            if group.extraCount > 0 {
                expandChip
            }
            if group.unreadCount > 0 {
                unreadBadge
            }
            if !group.vehicleIds.isEmpty {
                vehiclesAffected
            }
            Spacer(minLength: TSSpacing.xs)
            if group.unreadCount > 0, !model.filters.archived {
                markGroupRead
            }
        }
        .padding(.leading, TSSpacing.sm)
    }

    private var expandLabel: String {
        expanded
            ? model.localize("notifications.group.collapse", "Hide similar")
            : model.localizedCount("notifications.group.expand", "Show {{count}} similar", count: group.extraCount)
    }

    private var expandChip: some View {
        Button {
            expanded.toggle()
        } label: {
            HStack(spacing: 3) {
                Image(systemName: expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 9, weight: .bold))
                Text(verbatim: model.localizedCount(
                    "notifications.group.similar", "+{{count}} similar", count: group.extraCount
                ))
                .font(Font.TS.caption)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.accent.opacity(0.1), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.3), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: expandLabel))
    }

    private var unreadBadge: some View {
        Text(verbatim: "\(group.unreadCount)")
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.statusWarning)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusWarning.opacity(0.1), in: Capsule())
            .accessibilityLabel(Text(verbatim: model.localizedCount(
                "notifications.group.unreadA11y", "{{count}} unread", count: group.unreadCount
            )))
    }

    private var vehiclesAffected: some View {
        Text(verbatim: model.localizedCount(
            "notifications.group.vehicleAffected", "{{count}} vehicles affected", count: group.vehicleIds.count
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .lineLimit(1)
    }

    private var markGroupRead: some View {
        Button {
            Task { await model.markGroupRead(group) }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "envelope.open")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: model.localize("notifications.group.markRead", "Mark group read"))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize("notifications.group.markRead", "Mark group read")))
    }

    // MARK: Members (web expanded thread list)

    private var membersRegion: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if group.otherMembers.isEmpty {
                Text(verbatim: model.localize("notifications.group.noMembers", "No thread members found"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.vertical, TSSpacing.xs)
            } else {
                ForEach(group.otherMembers) { member in
                    InboxNotificationRowView(model: model, notification: member)
                }
            }
        }
        .padding(.leading, TSSpacing.md)
        .overlay(alignment: .leading) {
            Rectangle().fill(Color.TS.border).frame(width: 2)
        }
        .accessibilityLabel(Text(verbatim: model.localize("notifications.group.collapse", "Hide similar")))
    }
}
