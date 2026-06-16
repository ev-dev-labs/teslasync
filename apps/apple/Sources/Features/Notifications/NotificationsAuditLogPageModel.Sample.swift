import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed source
/// is injected at composition time. It is NOT production telemetry — it exists so the surface
/// renders its populated state out of the box (mirroring the sibling audit page's
/// `SampleAuditLogDataSource`). Production replaces it with the shared KMP `/system/audit`
/// binding through the seam.
public struct SampleNotificationsAuditLogDataSource: NotificationsAuditLogDataSource {
    public init() {}

    public func loadAuditLogs() async throws -> [AuditLogEntry] {
        Self.seed
    }

    static let seed: [AuditLogEntry] = [
        AuditLogEntry(
            id: "4821",
            action: "rule.update",
            resource: "alert_rule#17",
            details: "Updated low-battery threshold from 20% to 15%",
            createdAt: "2026-06-13T17:42:09Z"
        ),
        AuditLogEntry(
            id: "4820",
            action: "export.create",
            resource: "gdpr_export#88",
            details: "Queued GDPR export for subject #88",
            createdAt: "2026-06-13T16:08:53Z"
        ),
        AuditLogEntry(
            id: "4819",
            action: "vehicle.wake",
            resource: "vehicle#3",
            details: "Wake command rejected — vehicle asleep, retry budget exhausted",
            createdAt: "2026-06-13T15:51:00Z"
        ),
        AuditLogEntry(
            id: "4818",
            action: "settings.update",
            resource: "notification_channel#2",
            details: "Enabled Discord channel for critical alerts",
            createdAt: "2026-06-13T11:27:44Z"
        ),
        AuditLogEntry(
            id: "4817",
            action: "login",
            resource: "session",
            details: "Operator console sign-in",
            createdAt: "2026-06-13T09:14:22Z"
        )
    ]
}
