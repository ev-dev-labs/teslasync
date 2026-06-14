import Foundation

/// A representative in-memory seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production data — it exists so the
/// surface renders its populated state out of the box (mirroring the sibling
/// `SampleAuditLogDataSource`) and so create / edit / delete visibly mutate the registry
/// + change feed in previews. An `actor` so its mutable state stays isolated + `Sendable`
/// (the writes the page drives are real). Production replaces it with the feature-flag
/// adapter over the shared core.
public actor SampleFeatureFlagsDataSource: FeatureFlagsDataSource {
    private var flags: [String: FlagJSONValue]
    private var changes: [FeatureFlagChange]
    private var nextChangeID: Int64

    public init() {
        flags = Self.seedFlags
        changes = Self.seedChanges
        nextChangeID = 9100
    }

    public func loadFlags() async throws -> [FeatureFlagEntry] {
        flags.keys.sorted().map { FeatureFlagEntry(key: $0, value: flags[$0]!) }
    }

    public func loadChanges(limit: Int) async throws -> [FeatureFlagChange] {
        Array(changes.prefix(max(0, limit)))
    }

    public func setFlag(key: String, value: FlagJSONValue, reason: String) async throws {
        let previous = flags[key]
        flags[key] = value
        record(flagKey: key, operation: .set, oldValue: previous, newValue: value, reason: reason)
    }

    public func deleteFlag(key: String, reason: String) async throws {
        let previous = flags.removeValue(forKey: key)
        record(flagKey: key, operation: .delete, oldValue: previous, newValue: nil, reason: reason)
    }

    /// Prepends an audit row (most-recent-first) for a write, mirroring the backend's
    /// `feature_flag_changes` ledger.
    private func record(
        flagKey: String,
        operation: FeatureFlagOperation,
        oldValue: FlagJSONValue?,
        newValue: FlagJSONValue?,
        reason: String
    ) {
        let row = FeatureFlagChange(
            id: nextChangeID,
            changedAt: ISO8601DateFormatter().string(from: Date()),
            actor: "admin@local",
            actorIP: "10.0.4.22",
            flagKey: flagKey,
            operation: operation,
            oldValue: oldValue,
            newValue: newValue,
            reason: reason,
            traceID: String(format: "%016x", nextChangeID)
        )
        changes.insert(row, at: 0)
        nextChangeID += 1
    }

    static let seedFlags: [String: FlagJSONValue] = [
        "feature.dlq.replay_enabled": .bool(true),
        "feature.telemetry.sampling_rate": .number(0.25),
        "feature.ui.new_dashboard": .object(["enabled": .bool(false), "rollout": .number(10)]),
        "feature.export.formats": .array([.string("csv"), .string("json")])
    ]

    static let seedChanges: [FeatureFlagChange] = [
        FeatureFlagChange(
            id: 9042,
            changedAt: "2026-06-13T17:42:09Z",
            actor: "admin@local",
            actorIP: "10.0.4.22",
            flagKey: "feature.dlq.replay_enabled",
            operation: .set,
            oldValue: .bool(false),
            newValue: .bool(true),
            reason: "Enable DLQ replay after the 6.4 hotfix",
            traceID: "9f2c1ab47e3d5081"
        ),
        FeatureFlagChange(
            id: 9041,
            changedAt: "2026-06-13T16:08:53Z",
            actor: "svc-deployer",
            actorIP: "10.0.4.9",
            flagKey: "feature.ui.legacy_charts",
            operation: .delete,
            oldValue: .object(["enabled": .bool(true)]),
            newValue: nil,
            reason: "Removed legacy charts flag — fully rolled out",
            traceID: "3b7e90aa12cc4480"
        ),
        FeatureFlagChange(
            id: 9040,
            changedAt: "2026-06-12T09:14:22Z",
            actor: "admin@local",
            actorIP: "10.0.4.22",
            flagKey: "feature.telemetry.sampling_rate",
            operation: .set,
            oldValue: .number(0.1),
            newValue: .number(0.25),
            reason: "Raise telemetry sampling for the fleet rollout",
            traceID: "aa01bb23cc45dd67"
        )
    ]
}
