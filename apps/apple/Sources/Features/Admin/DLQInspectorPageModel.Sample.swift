import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleFeatureFlagsDataSource`) and so a replay visibly lands a fresh audit row in
/// previews. An `actor` so its mutable state stays isolated + `Sendable` (the replay it
/// performs is real). Production replaces it with the DLQ adapter over the shared core.
public actor SampleDLQInspectorDataSource: DLQInspectorDataSource {
    private var entries: [DLQEntrySummary]
    private var audit: [DLQReplayAuditRecord]
    private var replayEnabled: Bool
    private var nextAuditID: Int64

    public init(replayEnabled: Bool = true) {
        entries = Self.seedEntries
        audit = Self.seedAudit
        self.replayEnabled = replayEnabled
        nextAuditID = 4200
    }

    public func loadList() async throws -> DLQListResult {
        DLQListResult(count: entries.count, replayEnabled: replayEnabled, entries: entries)
    }

    public func loadEntry(id: Int64) async throws -> DLQEntryFull {
        guard let summary = entries.first(where: { $0.id == id }) else {
            throw DLQSampleError.notFound
        }
        let inner = Self.sampleInnerPayload(for: summary)
        let raw = Self.sampleRawEnvelope(for: summary)
        return DLQEntryFull(
            summary: summary,
            rawPayloadB64: Data(raw.utf8).base64EncodedString(),
            innerPayloadB64: Data(inner.utf8).base64EncodedString()
        )
    }

    public func loadAudit(limit: Int) async throws -> [DLQReplayAuditRecord] {
        Array(audit.prefix(max(0, limit)))
    }

    public func replay(id: Int64) async throws -> DLQReplayOutcome {
        guard replayEnabled else { throw DLQReplayDisabledError() }
        guard let entry = entries.first(where: { $0.id == id }) else {
            return DLQReplayOutcome(result: .notFound)
        }
        let topic = entry.parsedSourceTopic ?? "telemetry/replay"
        record(dlqID: id, dstTopic: topic, result: .ok)
        entries.removeAll { $0.id == id }
        return DLQReplayOutcome(result: .ok, dstTopic: topic)
    }

    /// Prepends an audit row (most-recent-first) for a replay, mirroring the backend's
    /// `dlq_replay_audit` ledger.
    private func record(dlqID: Int64, dstTopic: String, result: DLQReplayResult) {
        let row = DLQReplayAuditRecord(
            id: nextAuditID,
            replayedAt: ISO8601DateFormatter().string(from: Date()),
            actor: "admin@local",
            actorIP: "10.0.4.22",
            dlqID: dlqID,
            srcTopic: dstTopic,
            dstTopic: dstTopic,
            reason: "operator replay",
            result: result,
            error: "",
            traceID: String(format: "%016x", nextAuditID)
        )
        audit.insert(row, at: 0)
        nextAuditID += 1
    }

    enum DLQSampleError: Error {
        case notFound
    }

    static func sampleInnerPayload(for summary: DLQEntrySummary) -> String {
        """
        {"vin":"\(summary.parsedVIN ?? "—")","field":"\(summary.parsedReason)","value":42.7,\
        "ts":"\(summary.parsedTimestamp ?? summary.arrivedAt)"}
        """
    }

    static func sampleRawEnvelope(for summary: DLQEntrySummary) -> String {
        """
        topic=\(summary.dlqTopic) redeliveries=\(summary.parsedRedeliveries ?? 0) \
        size=\(summary.rawPayloadSize)
        """
    }

    static let seedEntries: [DLQEntrySummary] = [
        DLQEntrySummary(
            id: 5021,
            arrivedAt: "2026-06-14T03:12:48Z",
            dlqTopic: "telemetry/dlq/v/Location",
            parsedReason: "unknown_enum_value",
            parsedVehicleID: 3,
            parsedVIN: "5YJ3E1EA7KF000337",
            parsedSourceTopic: "telemetry/5YJ3E1EA7KF000337/v/Location",
            parsedRedeliveries: 5,
            parsedTimestamp: "2026-06-14T03:12:40Z",
            parseError: nil,
            replayable: true,
            rawPayloadSize: 412,
            innerPayloadSize: 188
        ),
        DLQEntrySummary(
            id: 5019,
            arrivedAt: "2026-06-14T02:58:11Z",
            dlqTopic: "telemetry/dlq/v/ChargeState",
            parsedReason: "kind_mismatch",
            parsedVehicleID: 1,
            parsedVIN: "7SAYGDEE9PF000912",
            parsedSourceTopic: "telemetry/7SAYGDEE9PF000912/v/ChargeState",
            parsedRedeliveries: 2,
            parsedTimestamp: "2026-06-14T02:58:03Z",
            parseError: nil,
            replayable: true,
            rawPayloadSize: 2613,
            innerPayloadSize: 1204
        ),
        DLQEntrySummary(
            id: 5004,
            arrivedAt: "2026-06-13T23:40:55Z",
            dlqTopic: "telemetry/dlq/unparseable",
            parsedReason: "malformed_envelope",
            parsedVehicleID: nil,
            parsedVIN: nil,
            parsedSourceTopic: nil,
            parsedRedeliveries: nil,
            parsedTimestamp: nil,
            parseError: "missing source topic header",
            replayable: false,
            rawPayloadSize: 96,
            innerPayloadSize: 0
        )
    ]

    static let seedAudit: [DLQReplayAuditRecord] = [
        DLQReplayAuditRecord(
            id: 4188,
            replayedAt: "2026-06-14T01:20:14Z",
            actor: "admin@local",
            actorIP: "10.0.4.22",
            dlqID: 4990,
            srcTopic: "telemetry/7SAYGDEE9PF000912/v/DriveState",
            dstTopic: "telemetry/7SAYGDEE9PF000912/v/DriveState",
            reason: "operator replay",
            result: .ok,
            error: "",
            traceID: "1c4af90b22e7d503"
        ),
        DLQReplayAuditRecord(
            id: 4187,
            replayedAt: "2026-06-14T00:51:39Z",
            actor: "svc-oncall",
            actorIP: "10.0.4.31",
            dlqID: 4981,
            srcTopic: "telemetry/5YJ3E1EA7KF000337/v/VehicleState",
            dstTopic: "",
            reason: "operator replay",
            result: .rateLimited,
            error: "per-actor replay budget exceeded",
            traceID: "9a02bb71cc38dd14"
        ),
        DLQReplayAuditRecord(
            id: 4186,
            replayedAt: "2026-06-13T22:09:02Z",
            actor: "admin@local",
            actorIP: "10.0.4.22",
            dlqID: 4975,
            srcTopic: "telemetry/dlq/unparseable",
            dstTopic: "",
            reason: "operator replay",
            result: .unparseable,
            error: "no source topic to publish to",
            traceID: "55de10aa1bcc4471"
        )
    ]
}
