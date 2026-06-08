//
//  InboxBody.Header.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The glass-panel header chrome composed by `InboxBody`: the select-all checkbox
//  (flat view only — web header `<input type="checkbox">`), the visible-item count
//  label (web `{{count}} notifications`), the grouped/flat view toggle (inbox tab
//  only — web segmented control), and the "Mark all read" affordance (inbox, flat,
//  unread > 0). Plus the day-bucket section header for the flat list. Strings come
//  from the P1/S10 facade; colours from the shared P1/S9 tokens.
//

import SwiftUI

// MARK: - Panel header (web select-all · count · view toggle · mark-all)

struct InboxPanelHeader: View {
    @Bindable var model: InboxBodyModel

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            if !model.isGrouped {
                selectAll
            }
            Text(verbatim: model.localizedCount(
                "notifications.inbox.countLabel", "{{count}} notifications", count: model.displayCount
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            if !model.filters.archived {
                InboxViewToggle(model: model)
            }
            if !model.filters.archived, !model.isGrouped, model.unreadCount > 0 {
                markAll
            }
        }
        .padding(.bottom, TSSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
    }

    private var selectAll: some View {
        Button {
            model.toggleSelectAllVisible(!model.allVisibleSelected)
        } label: {
            Image(systemName: model.allVisibleSelected ? "checkmark.square.fill" : "square")
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(model.allVisibleSelected ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize(
            "notifications.inbox.selectAll", "Select all visible"
        )))
        .accessibilityAddTraits(model.allVisibleSelected ? .isSelected : [])
    }

    private var markAll: some View {
        Button {
            Task { await model.markAllRead() }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 12, weight: .semibold))
                Text(verbatim: model.localize("notifications.markAllRead.action", "Mark all read"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize(
            "notifications.markAllRead.action", "Mark all read"
        )))
    }
}

// MARK: - View toggle (web grouped / flat segmented control)

struct InboxViewToggle: View {
    @Bindable var model: InboxBodyModel

    private var selection: Binding<InboxViewMode> {
        Binding(get: { model.filters.view }, set: { model.setView($0) })
    }

    var body: some View {
        Picker(selection: selection) {
            Text(verbatim: model.localize("notifications.view.grouped", "Grouped")).tag(InboxViewMode.grouped)
            Text(verbatim: model.localize("notifications.view.flat", "Flat")).tag(InboxViewMode.flat)
        } label: {
            Text(verbatim: model.localize("notifications.view.label", "View"))
        }
        .pickerStyle(.segmented)
        .fixedSize()
        .accessibilityLabel(Text(verbatim: model.localize("notifications.view.label", "View")))
    }
}

// MARK: - Day-bucket header (web `group.day` uppercase label)

/// The Today / Yesterday / dated section header for the flat list.
struct InboxDayHeader: View {
    let bucket: InboxDayBucket
    let localize: (String, String) -> String

    private var text: String {
        switch bucket {
        case .today: localize("common.today", "Today")
        case .yesterday: localize("common.yesterday", "Yesterday")
        case let .dated(label): label
        }
    }

    var body: some View {
        Text(verbatim: text.uppercased())
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}
