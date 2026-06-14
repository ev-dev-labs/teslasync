import Foundation

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists so
/// the surface renders its populated state out of the box (mirroring the sibling Disk
/// Forecast's `SampleDiskForecastDataSource` and Live Signal Inspector's sample seam).
/// Production replaces it with the `OperatorConfidenceStore` audit adapter.
public struct SampleAuditLogDataSource: AuditLogDataSource {
    public init() {}

    public func loadLog(_ query: AuditLogQuery) async throws -> [AuditLogRow] {
        Self.seed.filter { row in
            if !query.categories.isEmpty, let category = row.category, !query.categories.contains(category) {
                return false
            }
            if !query.actions.isEmpty, !query.actions.contains(row.action) { return false }
            if !query.actors.isEmpty, !query.actors.contains(row.actor) { return false }
            if let entityType = query.entityType, !entityType.isEmpty, row.entityType != entityType { return false }
            return true
        }
    }

    public func loadCategories() async throws -> [String] {
        ["auth", "config", "command", "data"]
    }

    public func loadActions() async throws -> [String] {
        ["login", "logout", "rule.update", "vehicle.wake", "export.create"]
    }

    public func verifyChain(limit: Int) async throws -> AuditChainVerify {
        AuditChainVerify(
            intact: true,
            firstBadID: 0,
            rowsChecked: Int64(Self.seed.count),
            since: "2026-05-14T00:00:00Z",
            limit: limit
        )
    }

    static let seed: [AuditLogRow] = [
        AuditLogRow(
            id: 4821,
            ts: "2026-06-13T17:42:09Z",
            actor: "admin@local",
            category: "config",
            action: "rule.update",
            entityType: "alert_rule",
            entityID: 17,
            detail: "Updated low-battery threshold from 20% to 15%",
            ip: "10.0.4.22",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)",
            before: "{\"threshold\":20}",
            after: "{\"threshold\":15}",
            traceID: "9f2c1ab47e3d5081bc66aa1290ffee31",
            prevRowHash: "0a1b2c3d4e5f60718293a4b5c6d7e8f9",
            rowHash: "f9e8d7c6b5a4938271605f4e3d2c1b0a",
            success: true
        ),
        AuditLogRow(
            id: 4820,
            ts: "2026-06-13T16:08:53Z",
            actor: "svc-exporter",
            category: "data",
            action: "export.create",
            entityType: "gdpr_export",
            entityID: 88,
            detail: "Queued GDPR export for subject #88",
            ip: "10.0.4.9",
            userAgent: "teslasync-export-worker/1.4.2",
            before: nil,
            after: "{\"status\":\"queued\"}",
            traceID: "3b7e90aa12cc4480ab15ee77def09921",
            prevRowHash: "112233445566778899aabbccddeeff00",
            rowHash: "00ffeeddccbbaa998877665544332211",
            success: true
        ),
        AuditLogRow(
            id: 4819,
            ts: "2026-06-13T15:51:00Z",
            actor: "admin@local",
            category: "command",
            action: "vehicle.wake",
            entityType: "vehicle",
            entityID: 3,
            detail: "Wake command rejected — vehicle asleep, retry budget exhausted",
            ip: "10.0.4.22",
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
            before: nil,
            after: nil,
            traceID: "aa01bb23cc45dd67ee89ff0123456789",
            prevRowHash: "deadbeefcafebabe0123456789abcdef",
            rowHash: "abcdef0123456789deadbeefcafebabe",
            success: false
        ),
        AuditLogRow(
            id: 4818,
            ts: "2026-06-13T09:14:22Z",
            actor: "admin@local",
            category: "auth",
            action: "login",
            entityType: "session",
            entityID: nil,
            detail: "Operator console sign-in",
            ip: "10.0.4.22",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)",
            before: nil,
            after: nil,
            traceID: nil,
            prevRowHash: "5566778899aabbccddeeff0011223344",
            rowHash: "44332211ffeeddccbbaa998877665566",
            success: true
        )
    ]
}
