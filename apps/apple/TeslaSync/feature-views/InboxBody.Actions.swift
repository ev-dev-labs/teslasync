//
//  InboxBody.Actions.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The mutation + bulk-action flows for `InboxBodyModel`, split from the store to
//  keep each file focused. Faithful ports of the web `InboxBody.tsx` handlers:
//  the per-row activate / mark / archive / restore / delete, the bulk mark read
//  (with the success-undo toast + the error toast), the bulk archive / restore
//  (with the polite screen-reader announcement), the bulk delete, the mark all
//  read flow, and the per-thread group mark read. All run on the main actor and
//  route through the injected mutation / toast / announcer seams.
//

import Foundation

// MARK: - Per-row actions (web row buttons / context menu / swipe)

public extension InboxBodyModel {
    /// Web `handleRowActivate`: clicking an unread row marks it read when the
    /// mark-on-click preference is enabled.
    func handleRowActivate(_ notification: InboxNotification) {
        guard !notification.isRead, preferences.markOnClick else { return }
        actions.markRead([notification.id])
    }

    func markRead(_ id: Int) {
        actions.markRead([id])
    }

    func markUnread(_ id: Int) {
        actions.markUnread([id])
    }

    func archiveRow(_ id: Int) {
        Task { await actions.archive([id]) }
    }

    func unarchiveRow(_ id: Int) {
        Task { await actions.unarchive([id]) }
    }

    func deleteRow(_ id: Int) {
        Task { await actions.delete([id]) }
    }

    /// Web `navigate(href)` for the "View context" drill-through.
    func openContext(_ href: String) {
        navigate(href)
    }

    /// Routes a per-row context-menu action to its handler.
    func performRowMenu(_ action: InboxRowMenuAction, on id: Int) {
        switch action {
        case .markRead: markRead(id)
        case .markUnread: markUnread(id)
        case .archive: archiveRow(id)
        case .unarchive: unarchiveRow(id)
        case let .viewContext(href): openContext(href)
        case .delete: deleteRow(id)
        }
    }
}

// MARK: - Bulk actions (web `bulkActions` onClick handlers)

public extension InboxBodyModel {
    /// Dispatches a toolbar bulk action over the current selection.
    func performBulk(_ action: InboxBulkAction) async {
        let ids = Array(selection)
        guard !ids.isEmpty else { return }
        switch action.kind {
        case .markRead: await bulkMarkRead(ids)
        case .archive: await bulkArchive(ids)
        case .restore: await bulkUnarchive(ids)
        case .delete: await bulkDelete(ids)
        }
    }

    /// Web `handleBulkMarkRead`: mark read, clear selection, toast success with an
    /// Undo that re-marks the ids unread; a failure raises the mark-read error toast.
    func bulkMarkRead(_ ids: [Int]) async {
        do {
            _ = try await actions.bulkMarkRead(InboxBulkMarkReadRequest(ids: ids))
        } catch {
            toast.error(
                title: localize("toast.notifications.markRead.error", "Failed to mark as read"),
                message: error.localizedDescription
            )
            return
        }
        clearSelection()
        toast.success(
            title: localizedCount("notifications.bulkRead.success", "{{count}} marked as read", count: ids.count),
            undoLabel: localize("common.undo", "Undo")
        ) { [weak self] in self?.actions.markUnread(ids) }
    }

    /// Web `handleBulkArchive`: archive, clear selection, announce the count.
    func bulkArchive(_ ids: [Int]) async {
        await actions.archive(ids)
        clearSelection()
        announcer.announce(localizedCount(
            "notifications.bulk.announceArchived", "{{count}} items archived", count: ids.count
        ))
    }

    /// Web `handleBulkUnarchive`: restore, clear selection, announce the count.
    func bulkUnarchive(_ ids: [Int]) async {
        await actions.unarchive(ids)
        clearSelection()
        announcer.announce(localizedCount(
            "notifications.bulk.announceRestored", "{{count}} items restored", count: ids.count
        ))
    }

    /// Web `handleBulkDelete`: delete, then clear selection.
    func bulkDelete(_ ids: [Int]) async {
        await actions.delete(ids)
        clearSelection()
    }

    /// Web `handleMarkAllRead`: no-op when nothing is unread; otherwise mark the
    /// whole inbox read, clear selection, and toast success with an Undo that
    /// re-marks the previously-visible unread ids. A failure raises the error toast.
    func markAllRead() async {
        guard unreadCount > 0 else { return }
        let visibleUnread = InboxProjection.unreadIds(rows)
        do {
            _ = try await actions.bulkMarkRead(InboxBulkMarkReadRequest(all: true))
        } catch {
            toast.error(
                title: localize("toast.notifications.markRead.error", "Failed to mark as read"),
                message: error.localizedDescription
            )
            return
        }
        clearSelection()
        postMarkAllReadToast(visibleUnread)
    }

    private func postMarkAllReadToast(_ visibleUnread: [Int]) {
        let title = localize("notifications.markAllRead.success", "All notifications marked as read")
        if visibleUnread.isEmpty {
            toast.success(title: title)
        } else {
            toast.success(title: title, undoLabel: localize("common.undo", "Undo")) { [weak self] in
                self?.actions.markUnread(visibleUnread)
            }
        }
    }

    /// Web `handleMarkGroupRead`: mark a whole thread read via its group key and
    /// toast the updated count; a failure raises the group error toast.
    func markGroupRead(_ group: InboxGroup) async {
        guard let groupKey = group.groupKey else { return }
        do {
            let updated = try await actions.bulkMarkRead(InboxBulkMarkReadRequest(groupKey: groupKey))
            toast.success(title: localizedCount(
                "notifications.group.markReadSuccess",
                "Marked {{count}} thread members as read",
                count: updated
            ))
        } catch {
            toast.error(
                title: localize("notifications.group.markReadError", "Could not mark group as read"),
                message: error.localizedDescription
            )
        }
    }

    // MARK: Helpers

    /// Localizes a `{{count}}`-templated string through the injected facade.
    internal func localizedCount(_ key: String, _ fallback: String, count: Int) -> String {
        localize(key, fallback).replacingOccurrences(of: "{{count}}", with: String(count))
    }
}
