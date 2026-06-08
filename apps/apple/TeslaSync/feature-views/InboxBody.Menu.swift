//
//  InboxBody.Menu.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The pure projection of the inbox's per-row context menu (web
//  `buildRowContextMenu`), the bulk-action list (web `bulkActions` useMemo), and
//  the VoiceOver row/group summaries. Foundation-only — the menu items + bulk
//  actions are data the view renders as a `.contextMenu` / toolbar, and the a11y
//  strings are asserted without rendering. Icons are resolved in the views.
//

import Foundation

// MARK: - Per-row context menu (web `buildRowContextMenu`)

/// The action a row context-menu item performs. `viewContext` carries the
/// drill-through href the navigation seam routes to.
public enum InboxRowMenuAction: Equatable, Sendable {
    case markRead
    case markUnread
    case archive
    case unarchive
    case viewContext(String)
    case delete
}

/// One row context-menu item — the localized label key + web English fallback,
/// the SF Symbol name, a destructive flag (web `destructive: true`), and the
/// action. `id` is stable for `ForEach`.
public struct InboxRowMenuItem: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String
    public let destructive: Bool
    public let action: InboxRowMenuAction

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        systemImage: String,
        destructive: Bool = false,
        action: InboxRowMenuAction
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
        self.destructive = destructive
        self.action = action
    }
}

public extension InboxProjection {
    /// Port of the web `buildRowContextMenu`: mark read/unread, archive/restore, an
    /// optional "View context" (only when the rule is known + a drill-through
    /// target exists), and a destructive delete.
    static func rowMenuItems(
        notification: InboxNotification,
        rule: InboxRule?,
        target: InboxDrillTarget?
    ) -> [InboxRowMenuItem] {
        var items: [InboxRowMenuItem] = []
        if !notification.isRead {
            items.append(InboxRowMenuItem(
                id: "mark-read", labelKey: "notifications.inbox.row.markRead",
                labelFallback: "Mark as read", systemImage: "envelope.open", action: .markRead
            ))
        } else {
            items.append(InboxRowMenuItem(
                id: "mark-unread", labelKey: "notifications.inbox.row.markUnread",
                labelFallback: "Mark as unread", systemImage: "envelope", action: .markUnread
            ))
        }
        if !notification.isArchived {
            items.append(InboxRowMenuItem(
                id: "archive", labelKey: "notifications.inbox.row.archive",
                labelFallback: "Archive", systemImage: "archivebox", action: .archive
            ))
        } else {
            items.append(InboxRowMenuItem(
                id: "restore", labelKey: "notifications.inbox.row.unarchive",
                labelFallback: "Restore", systemImage: "arrow.uturn.backward", action: .unarchive
            ))
        }
        if rule != nil, let target {
            items.append(InboxRowMenuItem(
                id: "view-context", labelKey: "alerts.viewContext",
                labelFallback: "View context", systemImage: "arrow.up.right.square",
                action: .viewContext(target.href)
            ))
        }
        items.append(InboxRowMenuItem(
            id: "delete", labelKey: "common.delete", labelFallback: "Delete",
            systemImage: "trash", destructive: true, action: .delete
        ))
        return items
    }
}

// MARK: - Bulk actions (web `bulkActions` useMemo)

/// The bulk-action kind the toolbar performs over the selected ids.
public enum InboxBulkActionKind: Equatable, Sendable {
    case markRead
    case archive
    case restore
    case delete
}

/// The destructive-confirm copy for a bulk action (web `confirm: { title,
/// description, confirmLabel }`).
public struct InboxBulkConfirm: Equatable, Sendable {
    public let titleKey: String
    public let titleFallback: String
    public let bodyKey: String
    public let bodyFallback: String
    public let confirmKey: String
    public let confirmFallback: String

    public init(
        titleKey: String, titleFallback: String,
        bodyKey: String, bodyFallback: String,
        confirmKey: String, confirmFallback: String
    ) {
        self.titleKey = titleKey
        self.titleFallback = titleFallback
        self.bodyKey = bodyKey
        self.bodyFallback = bodyFallback
        self.confirmKey = confirmKey
        self.confirmFallback = confirmFallback
    }
}

/// One bulk-action toolbar button — label key + web fallback, SF Symbol, a
/// danger flag (web `variant: 'danger'`), the kind, and an optional confirm.
public struct InboxBulkAction: Identifiable, Equatable, Sendable {
    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let systemImage: String
    public let destructive: Bool
    public let kind: InboxBulkActionKind
    public let confirm: InboxBulkConfirm?

    public init(
        id: String, labelKey: String, labelFallback: String, systemImage: String,
        destructive: Bool = false, kind: InboxBulkActionKind, confirm: InboxBulkConfirm? = nil
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.systemImage = systemImage
        self.destructive = destructive
        self.kind = kind
        self.confirm = confirm
    }
}

public extension InboxProjection {
    /// Port of the web `bulkActions`: mark-read + archive on the inbox tab, restore
    /// on the archive tab, and a destructive delete (with confirm) on both.
    static func bulkActions(archived: Bool) -> [InboxBulkAction] {
        var list: [InboxBulkAction] = []
        if !archived {
            list.append(InboxBulkAction(
                id: "mark-read", labelKey: "notifications.inbox.bulk.markRead",
                labelFallback: "Mark read", systemImage: "envelope.open", kind: .markRead
            ))
            list.append(InboxBulkAction(
                id: "archive", labelKey: "notifications.inbox.bulk.archive",
                labelFallback: "Archive", systemImage: "archivebox", kind: .archive
            ))
        } else {
            list.append(InboxBulkAction(
                id: "restore", labelKey: "notifications.inbox.bulk.restore",
                labelFallback: "Restore", systemImage: "arrow.uturn.backward", kind: .restore
            ))
        }
        list.append(InboxBulkAction(
            id: "delete", labelKey: "bulk.actions.delete", labelFallback: "Delete",
            systemImage: "trash", destructive: true, kind: .delete,
            confirm: InboxBulkConfirm(
                titleKey: "notifications.inbox.bulk.deleteConfirmTitle",
                titleFallback: "Delete notifications?",
                bodyKey: "notifications.inbox.bulk.deleteConfirmBody",
                bodyFallback: "These notifications will be permanently removed. "
                    + "Archive is usually the safer choice.",
                confirmKey: "common.delete", confirmFallback: "Delete"
            )
        ))
        return list
    }
}

// MARK: - Accessibility (localized through an injected facade)

/// Resolves each row's VoiceOver summary through an injected localizer so the
/// strings stay in the P1/S10 catalog and the spoken content is asserted without
/// rendering. Pure + bundle-free in tests.
public enum InboxAccessibility {
    public typealias Localize = (String, String) -> String

    /// One combined VoiceOver string for a row (read-state · severity · time ·
    /// vehicle · rule · title · message).
    public static func rowSummary(
        notification: InboxNotification,
        rule: InboxRule?,
        vehicle: InboxVehicle?,
        relativeTime: String,
        _ localize: Localize
    ) -> String {
        let severity = InboxSeverity.parse(rule?.severity ?? notification.severity)
        var parts: [String] = []
        parts.append(notification.isRead
            ? localize("notifications.inbox.a11y.read", "Read")
            : localize("notifications.inbox.a11y.unread", "Unread"))
        parts.append(localize(severity.labelKey, severity.labelFallback))
        if !relativeTime.isEmpty { parts.append(relativeTime) }
        if let vehicle { parts.append(vehicle.label) }
        if let name = rule?.name, !name.isEmpty { parts.append(name) }
        parts.append(notification.title)
        if !notification.message.isEmpty { parts.append(notification.message) }
        return parts.joined(separator: ", ")
    }

    /// One combined VoiceOver string for a thread head (row summary + the "+N
    /// similar" overflow when the group is not a singleton).
    public static func groupSummary(
        group: InboxGroup,
        headSummary: String,
        _ localize: Localize
    ) -> String {
        guard !group.isSingleton, group.extraCount > 0 else { return headSummary }
        let similar = localize("notifications.group.similar", "+{{count}} similar")
            .replacingOccurrences(of: "{{count}}", with: String(group.extraCount))
        return "\(headSummary), \(similar)"
    }
}
