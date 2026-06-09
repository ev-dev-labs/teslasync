//
//  OperationsSection.Tables.swift
//  TeslaSync — P4 feature view · 0250 · OperationsSection (Apple)
//
//  The two Operations tables — the SwiftUI parity of the web `DataTable`s in
//  features/system/components/status/OperationsSection.tsx: the recent-notifications
//  table (status · title · message · time) and the audit-log table (time · action ·
//  resource · details), both over the shared `TSDataTable`. Cell content + the per-row
//  VoiceOver label are composed from the P1/S10 facade + P1/S9 tokens — no networking,
//  no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Recent notifications table (web notif-log `DataTable`)

/// The recent-notifications table — the shared `TSDataTable` carrying the four web
/// columns (status · title · message · time).
struct OperationsNotificationsTable: View {
    let logs: [NotificationLogItem]

    var body: some View {
        TSDataTable(rows: logs, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [TSColumn<NotificationLogItem>] {
        [statusColumn, titleColumn, messageColumn, timeColumn]
    }

    private func rowAccessibilityLabel(for log: NotificationLogItem) -> String {
        OperationsAccessibility.notificationRowLabel(
            status: log.status,
            title: log.title,
            message: log.message,
            time: OperationsFormat.dateTime(log.createdAt)
        )
    }

    private var statusColumn: TSColumn<NotificationLogItem> {
        TSColumn(
            id: "status",
            title: OperationsStrings.key("Status", "Status"),
            comparator: { lhs, rhs in lhs.status.localizedCompare(rhs.status) },
            cell: { log in
                let kind = log.statusKind
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: kind.symbolName)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(kind.tone.tsTone.color)
                        .accessibilityHidden(true)
                    Text(verbatim: log.status)
                        .foregroundStyle(kind.tone.tsTone.color)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(for: log)))
            }
        )
    }

    private var titleColumn: TSColumn<NotificationLogItem> {
        TSColumn(
            id: "title",
            title: OperationsStrings.key("Title", "Title"),
            comparator: { lhs, rhs in lhs.title.localizedCompare(rhs.title) },
            cell: { log in
                Text(verbatim: log.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        )
    }

    private var messageColumn: TSColumn<NotificationLogItem> {
        TSColumn(id: "message", title: OperationsStrings.key("Message", "Message")) { log in
            Text(verbatim: log.message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var timeColumn: TSColumn<NotificationLogItem> {
        TSColumn(
            id: "time",
            title: OperationsStrings.key("Time", "Time"),
            comparator: { lhs, rhs in OperationsColumnCompare.dates(lhs.createdAt, rhs.createdAt) },
            cell: { log in
                Text(verbatim: OperationsFormat.dateTime(log.createdAt))
                    .foregroundStyle(Color.TS.textSecondary)
            }
        )
    }
}

// MARK: - Audit log table (web audit `DataTable`)

/// The audit-log table — the shared `TSDataTable` carrying the four web columns
/// (time · action · resource · details).
struct OperationsAuditTable: View {
    let logs: [AuditLogItem]

    var body: some View {
        TSDataTable(rows: logs, columns: columns, density: .compact)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var columns: [TSColumn<AuditLogItem>] {
        [timeColumn, actionColumn, resourceColumn, detailsColumn]
    }

    private func rowAccessibilityLabel(for log: AuditLogItem) -> String {
        OperationsAccessibility.auditRowLabel(
            time: OperationsFormat.dateTime(log.createdAt),
            action: log.action,
            resource: log.resource,
            details: log.details
        )
    }

    private var timeColumn: TSColumn<AuditLogItem> {
        TSColumn(
            id: "time",
            title: OperationsStrings.key("Time", "Time"),
            comparator: { lhs, rhs in OperationsColumnCompare.dates(lhs.createdAt, rhs.createdAt) },
            cell: { log in
                Text(verbatim: OperationsFormat.dateTime(log.createdAt))
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityLabel(Text(verbatim: rowAccessibilityLabel(for: log)))
            }
        )
    }

    private var actionColumn: TSColumn<AuditLogItem> {
        TSColumn(
            id: "action",
            title: OperationsStrings.key("Action", "Action"),
            comparator: { lhs, rhs in lhs.action.localizedCompare(rhs.action) },
            cell: { log in
                TSBadge(LocalizedStringKey(log.action), tone: .info)
            }
        )
    }

    private var resourceColumn: TSColumn<AuditLogItem> {
        TSColumn(
            id: "resource",
            title: OperationsStrings.key("Resource", "Resource"),
            comparator: { lhs, rhs in lhs.resource.localizedCompare(rhs.resource) },
            cell: { log in
                Text(verbatim: log.resource)
                    .font(Font.TS.caption.monospaced())
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        )
    }

    private var detailsColumn: TSColumn<AuditLogItem> {
        TSColumn(id: "details", title: OperationsStrings.key("Details", "Details")) { log in
            Text(verbatim: log.details)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

// MARK: - Column comparator (sortable created-at columns)

/// Pure comparator for the sortable date columns, kept separate so the cell builders
/// stay declarative and the sort logic is reused across both tables.
enum OperationsColumnCompare {
    static func dates(_ lhs: Date?, _ rhs: Date?) -> ComparisonResult {
        switch (lhs, rhs) {
        case let (left?, right?): left.compare(right)
        case (nil, nil): .orderedSame
        case (nil, _): .orderedAscending
        case (_, nil): .orderedDescending
        }
    }
}
