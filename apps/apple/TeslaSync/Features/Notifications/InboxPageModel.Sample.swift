//
//  InboxPageModel.Sample.swift
//  TeslaSync — P4-APPLE P7 · page:notifications/Inbox (Apple) — Sample data seam
//
//  A representative local seed used as the page/preview default until the KMP-backed
//  notification bindings are injected at composition time. It is NOT production data — it exists
//  so the hosted active `InboxBody` renders its populated (loaded) state out of the box,
//  mirroring the sibling `SampleArchivedInbox` factory. Production replaces it with the shared
//  KMP `useNotificationLogs` / `useNotificationGroups` / `useAlertRules` / `useVehicles` bindings
//  through the `InboxSource` + `InboxActionsPerforming` seams (ADR-004 — no networking in the view).
//

import Foundation

public enum SampleInbox {
    /// Builds an in-memory source pre-seeded with active rows + threaded groups + the rule/vehicle
    /// context the inbox resolves against, in a live, loaded snapshot. Both the flat list and the
    /// grouped threads are populated so either inbox view (web default = grouped) shows content.
    @MainActor
    public static func makeSource() -> any InboxSource {
        InMemoryInboxSource(initial: update)
    }

    /// Builds the inert mutation seam the page default binds (no network, no side effects).
    /// Production injects the shared KMP notification mutation holders here.
    @MainActor
    public static func makeActions() -> any InboxActionsPerforming {
        InboxInertActions()
    }

    /// Web `useVehicles()` directory the active rows resolve their display name against.
    static let vehicles: [InboxVehicle] = [
        InboxVehicle(id: 1, displayName: "Model Y"),
        InboxVehicle(id: 2, displayName: "Model 3")
    ]

    /// Web `useAlertRules()` set the active rows resolve their severity/name against.
    static let rules: [InboxRule] = [
        InboxRule(id: 10, name: "Low battery", severity: "warn", vehicleId: 1, signalName: "BatteryLevel"),
        InboxRule(id: 11, name: "Sentry triggered", severity: "critical", vehicleId: 2, signalName: "SentryMode"),
        InboxRule(id: 12, name: "Charging complete", severity: "info", vehicleId: 1, signalName: "ChargeState")
    ]

    /// Three recent, non-archived rows (a mix of unread + read; no `archived_at`), driving the
    /// flat-list view's Today / Yesterday day grouping.
    static let rows: [InboxNotification] = [
        InboxNotification(
            id: 1, alertId: 10, title: "Battery at 18%",
            message: "Model Y dropped below the 20% threshold.",
            createdAt: iso(daysAgo: 0, hour: 8)
        ),
        InboxNotification(
            id: 2, alertId: 11, title: "Sentry event recorded",
            message: "Motion detected near the driver door.",
            createdAt: iso(daysAgo: 0, hour: 6), readAt: iso(daysAgo: 0, hour: 7)
        ),
        InboxNotification(
            id: 3, alertId: 12, title: "Charging complete",
            message: "Model Y reached the 80% charge limit.",
            createdAt: iso(daysAgo: 1, hour: 22)
        )
    ]

    /// Two threaded groups (web `useNotificationGroups`) — one coalesced low-battery thread with
    /// unread members, one singleton — so the grouped (default) inbox view renders content.
    static let groups: [InboxGroup] = [
        InboxGroup(
            groupKey: "grp-low-batt", latest: rows[0], count: 4, unreadCount: 3,
            vehicleIds: [1, 2],
            members: [
                InboxNotification(
                    id: 21, alertId: 10, title: "Battery at 19%",
                    createdAt: iso(daysAgo: 0, hour: 5)
                ),
                InboxNotification(
                    id: 22, alertId: 10, title: "Battery at 22%",
                    createdAt: iso(daysAgo: 1, hour: 23)
                )
            ]
        ),
        InboxGroup(groupKey: nil, latest: rows[1], count: 1, unreadCount: 0)
    ]

    /// The coalesced loaded snapshot the in-memory source pushes (flat + grouped both loaded).
    static var update: InboxUpdate {
        InboxUpdate(
            flatStatus: .loaded,
            groupStatus: .loaded,
            rows: rows,
            groups: groups,
            rules: rules,
            vehicles: vehicles,
            connection: .live,
            updatedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    /// A stable ISO-8601 timestamp `daysAgo` days before the seed midnight at `hour`.
    static func iso(daysAgo: Int, hour: Int) -> String {
        let calendar = Calendar.current
        let midnight = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_750_000_000))
        let day = calendar.date(byAdding: .day, value: -daysAgo, to: midnight) ?? midnight
        let stamped = calendar.date(byAdding: .hour, value: hour, to: day) ?? day
        return ISO8601DateFormatter().string(from: stamped)
    }
}

/// Inert mutation seam for the page/preview default — every mutation is a no-op. Production
/// replaces it with the shared KMP notification mutation holders (web `useMark*` / `useArchive*`
/// / `useDelete` hooks) through the `InboxActionsPerforming` seam.
@MainActor
private final class InboxInertActions: InboxActionsPerforming {
    func markRead(_: [Int]) {}
    func markUnread(_: [Int]) {}
    func archive(_: [Int]) async {}
    func unarchive(_: [Int]) async {}
    func delete(_: [Int]) async {}
    func bulkMarkRead(_ request: InboxBulkMarkReadRequest) async throws -> Int {
        request.ids?.count ?? 0
    }
}
