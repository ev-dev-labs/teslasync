//
//  NotificationGroupRow.Previews.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  Xcode previews — one per state the surface produces: content (a multi-member
//  thread with the grouping chrome), singleton (group_key == null → plain row, no
//  chrome), empty (resolved, no thread), loading (skeleton chrome), error (fetch
//  failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentNotificationGroupTelemetry: NotificationGroupRowTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample threads + members for the populated previews.
    private enum NotificationGroupPreviewData {
        static let base = Date(timeIntervalSince1970: 1_733_600_000)

        static func log(
            _ id: Int,
            _ title: String,
            severity: String?,
            read: Bool,
            offset: TimeInterval = 0
        ) -> NotificationLogInput {
            NotificationLogInput(
                id: id,
                title: title,
                message: "Tap to view the full alert context and recent telemetry.",
                severityRaw: severity,
                createdAt: base.addingTimeInterval(offset),
                isRead: read,
                isArchived: false,
                vehicleName: "Model 3 Performance",
                ruleName: "Battery temperature high"
            )
        }

        static let thread = NotificationGroupInput(
            groupKey: "a1b2c3",
            latest: log(101, "Battery temperature high", severity: "critical", read: false),
            count: 5,
            unreadCount: 3,
            vehicleAffectedCount: 2
        )

        static let singleton = NotificationGroupInput(
            groupKey: nil,
            latest: log(202, "Software update available", severity: "info", read: false),
            count: 1,
            unreadCount: 1,
            vehicleAffectedCount: 1
        )

        static let members = NotificationMembersUpdate(
            status: .loaded,
            members: [
                log(102, "Battery temperature high", severity: "critical", read: true, offset: -3600),
                log(103, "Battery temperature high", severity: "warn", read: true, offset: -7200),
                log(104, "Battery temperature high", severity: "warn", read: false, offset: -10800)
            ]
        )
    }

    @MainActor
    private func notificationGroupPreview(
        _ update: NotificationGroupUpdate,
        members: NotificationMembersUpdate? = nil
    ) -> NotificationGroupRow {
        NotificationGroupRow(
            model: NotificationGroupRowModel(
                source: InMemoryNotificationGroupRowSource(
                    initial: update,
                    membersResult: members,
                    markReadResult: .success(updated: 3)
                ),
                telemetry: SilentNotificationGroupTelemetry()
            )
        )
    }

    #Preview("Content") {
        notificationGroupPreview(
            NotificationGroupUpdate(status: .loaded, group: NotificationGroupPreviewData.thread, connection: .live),
            members: NotificationGroupPreviewData.members
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Singleton") {
        notificationGroupPreview(
            NotificationGroupUpdate(status: .loaded, group: NotificationGroupPreviewData.singleton, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        notificationGroupPreview(NotificationGroupUpdate(status: .loaded, group: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        notificationGroupPreview(NotificationGroupUpdate(status: .loading, group: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        notificationGroupPreview(
            NotificationGroupUpdate(status: .failed("Request timed out"), group: nil, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        notificationGroupPreview(
            NotificationGroupUpdate(status: .loaded, group: NotificationGroupPreviewData.thread, connection: .stale),
            members: NotificationGroupPreviewData.members
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        notificationGroupPreview(
            NotificationGroupUpdate(status: .loaded, group: NotificationGroupPreviewData.thread, connection: .offline),
            members: NotificationGroupPreviewData.members
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
