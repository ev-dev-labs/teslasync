import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed
/// notification bindings are injected at composition time. It is NOT production data — it exists
/// so the hosted archived `InboxBody` renders its populated (loaded) state out of the box,
/// mirroring the sibling pages' `Sample*Source` factories. Production replaces it with the shared
/// KMP `useNotificationLogs` / `useAlertRules` / `useVehicles` bindings through the `InboxSource`
/// + `InboxActionsPerforming` seams (ADR-004 — no networking in the view).
public enum SampleArchivedInbox {
    /// Builds an in-memory source pre-seeded with archived rows + the rule/vehicle context the
    /// inbox resolves against, in a live, loaded snapshot (archived view is always flat).
    @MainActor
    public static func makeSource() -> any InboxSource {
        InMemoryInboxSource(initial: update)
    }

    /// Builds the inert mutation seam the page default binds (no network, no side effects).
    /// Production injects the shared KMP notification mutation holders here.
    @MainActor
    public static func makeActions() -> any InboxActionsPerforming {
        InertInboxActions()
    }

    /// Web `useVehicles()` directory the archived rows resolve their display name against.
    static let vehicles: [InboxVehicle] = [
        InboxVehicle(id: 1, displayName: "Model Y"),
        InboxVehicle(id: 2, displayName: "Model 3")
    ]

    /// Web `useAlertRules()` set the archived rows resolve their severity/name against.
    static let rules: [InboxRule] = [
        InboxRule(id: 10, name: "Low battery", severity: "warn", vehicleId: 1, signalName: "BatteryLevel"),
        InboxRule(id: 11, name: "Sentry triggered", severity: "critical", vehicleId: 2, signalName: "SentryMode"),
        InboxRule(id: 12, name: "Charging complete", severity: "info", vehicleId: 1, signalName: "ChargeState")
    ]

    /// Three previously-archived rows (each carries a non-empty `archivedAt`, web `!!archived_at`).
    static let rows: [InboxNotification] = [
        InboxNotification(
            id: 101, alertId: 10, title: "Battery at 18%",
            message: "Model Y dropped below the 20% threshold.",
            createdAt: iso(daysAgo: 2, hour: 8),
            readAt: iso(daysAgo: 2, hour: 9), archivedAt: iso(daysAgo: 1, hour: 10)
        ),
        InboxNotification(
            id: 102, alertId: 11, title: "Sentry event recorded",
            message: "Motion detected near the driver door.",
            createdAt: iso(daysAgo: 3, hour: 6),
            readAt: iso(daysAgo: 3, hour: 7), archivedAt: iso(daysAgo: 2, hour: 12)
        ),
        InboxNotification(
            id: 103, alertId: 12, title: "Charging complete",
            message: "Model Y reached the 80% charge limit.",
            createdAt: iso(daysAgo: 5, hour: 22),
            readAt: iso(daysAgo: 5, hour: 23), archivedAt: iso(daysAgo: 4, hour: 8)
        )
    ]

    /// The coalesced loaded snapshot the in-memory source pushes (archived = flat list).
    static var update: InboxUpdate {
        InboxUpdate(
            flatStatus: .loaded,
            groupStatus: .loaded,
            rows: rows,
            groups: [],
            rules: rules,
            vehicles: vehicles,
            connection: .live,
            updatedAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
    }

    /// A stable ISO-8601 timestamp `daysAgo` days before today's midnight at `hour`.
    static func iso(daysAgo: Int, hour: Int) -> String {
        let calendar = Calendar.current
        let midnight = calendar.startOfDay(for: Date(timeIntervalSince1970: 1_750_000_000))
        let day = calendar.date(byAdding: .day, value: -daysAgo, to: midnight) ?? midnight
        let stamped = calendar.date(byAdding: .hour, value: hour, to: day) ?? day
        return ISO8601DateFormatter().string(from: stamped)
    }
}

/// Inert mutation seam for the page/preview default — every mutation is a no-op. Production
/// replaces it with the shared KMP notification mutation holders (web `useArchive*` / `useMark*`
/// / `useDelete` hooks) through the `InboxActionsPerforming` seam.
@MainActor
private final class InertInboxActions: InboxActionsPerforming {
    func markRead(_: [Int]) {}
    func markUnread(_: [Int]) {}
    func archive(_: [Int]) async {}
    func unarchive(_: [Int]) async {}
    func delete(_: [Int]) async {}
    func bulkMarkRead(_ request: InboxBulkMarkReadRequest) async throws -> Int {
        request.ids?.count ?? 0
    }
}
