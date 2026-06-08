//
//  InboxBody.RowMenu.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The per-row action affordances shared by the trailing menu button and the
//  long-press context menu — the native parity of the web row quick buttons +
//  `buildRowContextMenu` (mark read/unread · archive/restore · view context ·
//  delete). One source of truth (`InboxBodyModel.rowMenuItems`) drives both so
//  the action set never drifts between the discoverable menu and the context menu.
//

import SwiftUI

/// The per-row action buttons (web `buildRowContextMenu` items) — shared by the
/// trailing menu and the long-press context menu.
struct InboxRowMenuItems: View {
    @Bindable var model: InboxBodyModel
    let notification: InboxNotification

    var body: some View {
        ForEach(model.rowMenuItems(for: notification)) { item in
            Button(role: item.destructive ? .destructive : nil) {
                model.performRowMenu(item.action, on: notification.id)
            } label: {
                Label {
                    Text(verbatim: model.localize(item.labelKey, item.labelFallback))
                } icon: {
                    Image(systemName: item.systemImage)
                }
            }
        }
    }
}

/// The trailing per-row action menu — the discoverable affordance for the web
/// hover quick buttons + the right-click context menu.
struct InboxRowMenu: View {
    @Bindable var model: InboxBodyModel
    let notification: InboxNotification

    var body: some View {
        Menu {
            InboxRowMenuItems(model: model, notification: notification)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 16))
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityLabel(Text(verbatim: model.localize(
            "notifications.inbox.row.moreActions", "More actions"
        )))
    }
}
