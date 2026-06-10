//
//  NotificationRow.Previews.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  Xcode previews — one per state the surface produces: content (unread, with the
//  accent bar + full action cluster), read (mark-unread action), selected, archived
//  (restore action), no-rule (no "View context"), empty (resolved, no row), loading
//  (skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentNotificationRowTelemetry: NotificationRowTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample rows for the populated previews.
    private enum NotificationRowPreviewData {
        static let base = Date(timeIntervalSince1970: 1_733_600_000)

        static func row(
            id: Int = 101,
            title: String = "Battery temperature high",
            severity: String? = "critical",
            read: Bool = false,
            archived: Bool = false,
            hasRule: Bool = true
        ) -> NotificationRowInput {
            NotificationRowInput(
                id: id,
                title: title,
                message: "Tap to view the full alert context and recent telemetry.",
                severityRaw: severity,
                createdAt: base,
                isRead: read,
                isArchived: archived,
                vehicleName: "Model 3 Performance",
                ruleName: hasRule ? "Battery temperature high" : nil,
                hasRule: hasRule,
                ruleSignal: hasRule ? "BatteryLevel" : nil,
                drillVehicleID: 7,
                createdAtISO: "2024-12-07T18:13:20Z"
            )
        }
    }

    @MainActor
    private func notificationRowPreview(_ update: NotificationRowUpdate) -> NotificationRow {
        NotificationRow(
            model: NotificationRowModel(
                source: InMemoryNotificationRowSource(initial: update),
                telemetry: SilentNotificationRowTelemetry()
            )
        )
    }

    #Preview("Unread") {
        notificationRowPreview(
            NotificationRowUpdate(status: .loaded, row: NotificationRowPreviewData.row(), connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Read") {
        notificationRowPreview(
            NotificationRowUpdate(
                status: .loaded,
                row: NotificationRowPreviewData.row(read: true),
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Selected") {
        notificationRowPreview(
            NotificationRowUpdate(
                status: .loaded,
                row: NotificationRowPreviewData.row(),
                connection: .live,
                selected: true
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Archived") {
        notificationRowPreview(
            NotificationRowUpdate(
                status: .loaded,
                row: NotificationRowPreviewData.row(read: true, archived: true),
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("No rule (no drill-through)") {
        notificationRowPreview(
            NotificationRowUpdate(
                status: .loaded,
                row: NotificationRowPreviewData.row(severity: nil, hasRule: false),
                connection: .live
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Empty") {
        notificationRowPreview(NotificationRowUpdate(status: .loaded, row: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Loading") {
        notificationRowPreview(NotificationRowUpdate(status: .loading, row: nil, connection: .live))
            .padding()
            .frame(maxWidth: 480)
    }

    #Preview("Error") {
        notificationRowPreview(
            NotificationRowUpdate(status: .failed("Request timed out"), row: nil, connection: .live)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Stale") {
        notificationRowPreview(
            NotificationRowUpdate(status: .loaded, row: NotificationRowPreviewData.row(), connection: .stale)
        )
        .padding()
        .frame(maxWidth: 480)
    }

    #Preview("Offline") {
        notificationRowPreview(
            NotificationRowUpdate(
                status: .loaded,
                row: NotificationRowPreviewData.row(read: true),
                connection: .offline
            )
        )
        .padding()
        .frame(maxWidth: 480)
    }
#endif
