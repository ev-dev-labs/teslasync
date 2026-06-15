//
//  AuditPanel.Models.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  Domain value types ported from the web source's data contracts
//  (web/src/types/admin-diagnostics.ts `AuditPanelDLQReplayRecord` / `AuditPanelDLQReplayResult`)
//  plus the snake-case decode adapter the production source uses to project the
//  cached DTOs. Pure Foundation — no SwiftUI, no Shared xcframework — so the file
//  host-compiles and the cached→projection adapter is unit-testable in isolation.
//

import Foundation

// MARK: - AuditResultTone (Foundation-level semantic tone)

/// Semantic tone of a result chip, kept SwiftUI-free so the projection stays
/// unit-testable; the view maps it onto the shared `TSTone` at the render edge.
public enum AuditResultTone: String, Equatable, Sendable {
    case neutral
    case success
    case warning
    case danger
}

// MARK: - AuditPanelDLQReplayResult (web `AuditPanelDLQReplayResult` union)

/// Stable result code of one replay attempt (web `AuditPanelDLQReplayResult`), with an
/// `unknown` fallback so an unexpected server value never crashes the table.
/// Mirrors the constants block in `internal/database/dlq_replay_audit_repo.go`.
public enum AuditPanelDLQReplayResult: String, Sendable, CaseIterable {
    case ok
    case publishFailed
    case rateLimited
    case disabled
    case notFound
    case unparseable
    case unknown

    /// Maps the snake-case wire value (`publish_failed`) to a case.
    public init(rawTag: String?) {
        switch (rawTag ?? "").lowercased() {
        case "ok": self = .ok
        case "publish_failed", "publishfailed": self = .publishFailed
        case "rate_limited", "ratelimited": self = .rateLimited
        case "disabled": self = .disabled
        case "not_found", "notfound": self = .notFound
        case "unparseable": self = .unparseable
        default: self = .unknown
        }
    }

    /// The wire/display token the web Badge renders verbatim (`{row.result}`).
    public var rawTag: String {
        switch self {
        case .ok: "ok"
        case .publishFailed: "publish_failed"
        case .rateLimited: "rate_limited"
        case .disabled: "disabled"
        case .notFound: "not_found"
        case .unparseable: "unparseable"
        case .unknown: "—"
        }
    }

    /// The per-surface i18n key for the localized result token.
    public var localizationKey: String {
        switch self {
        case .ok: "admin.dlq.audit.result.ok"
        case .publishFailed: "admin.dlq.audit.result.publishFailed"
        case .rateLimited: "admin.dlq.audit.result.rateLimited"
        case .disabled: "admin.dlq.audit.result.disabled"
        case .notFound: "admin.dlq.audit.result.notFound"
        case .unparseable: "admin.dlq.audit.result.unparseable"
        case .unknown: "admin.dlq.audit.result.unknown"
        }
    }

    /// The semantic tone of the result chip (web `RESULT_VARIANT`): ok→success,
    /// publish_failed/unparseable→danger, rate_limited/disabled→warning,
    /// not_found/unknown→neutral.
    public var tone: AuditResultTone {
        switch self {
        case .ok: .success
        case .publishFailed, .unparseable: .danger
        case .rateLimited, .disabled: .warning
        case .notFound, .unknown: .neutral
        }
    }
}

// MARK: - AuditPanelDLQReplayRecord (web `AuditPanelDLQReplayRecord`)

/// One replay-audit row (web `AuditPanelDLQReplayRecord`). Only the fields the panel
/// reads are modeled; `replayedAt` is optional because a malformed timestamp must
/// degrade to an em-dash rather than drop the row.
public struct AuditPanelDLQReplayRecord: Identifiable, Equatable, Sendable {
    public let id: Int
    public var replayedAt: Date?
    public var actor: String
    public var dlqId: Int
    public var dstTopic: String
    public var result: AuditPanelDLQReplayResult
    public var error: String
    public var traceId: String

    public init(
        id: Int,
        replayedAt: Date? = nil,
        actor: String = "",
        dlqId: Int = 0,
        dstTopic: String = "",
        result: AuditPanelDLQReplayResult = .unknown,
        error: String = "",
        traceId: String = ""
    ) {
        self.id = id
        self.replayedAt = replayedAt
        self.actor = actor
        self.dlqId = dlqId
        self.dstTopic = dstTopic
        self.result = result
        self.error = error
        self.traceId = traceId
    }
}

// MARK: - Decode adapter (snake-case DTO → value types)

public extension AuditPanelDLQReplayRecord {
    private struct DTO: Decodable {
        let id: Int
        let replayedAt: String?
        let actor: String?
        let dlqId: Int?
        let dstTopic: String?
        let result: String?
        let error: String?
        let traceId: String?
    }

    /// Decodes one `/system/dlq/audit` row object (snake-case JSON).
    static func decode(fromJSONString json: String) -> AuditPanelDLQReplayRecord? {
        guard let data = json.data(using: .utf8) else { return nil }
        guard let dto = try? makeDecoder().decode(DTO.self, from: data) else { return nil }
        return record(from: dto)
    }

    /// Decodes the `/system/dlq/audit` snake-case JSON array (`DLQAuditResponse.rows`).
    static func decodeList(fromJSONString json: String) -> [AuditPanelDLQReplayRecord] {
        guard let data = json.data(using: .utf8) else { return [] }
        guard let dtos = try? makeDecoder().decode([DTO].self, from: data) else { return [] }
        return dtos.map(record(from:))
    }

    private static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }

    private static func record(from dto: DTO) -> AuditPanelDLQReplayRecord {
        AuditPanelDLQReplayRecord(
            id: dto.id,
            replayedAt: DLQAuditTime.parse(dto.replayedAt),
            actor: dto.actor ?? "",
            dlqId: dto.dlqId ?? 0,
            dstTopic: dto.dstTopic ?? "",
            result: AuditPanelDLQReplayResult(rawTag: dto.result),
            error: dto.error ?? "",
            traceId: dto.traceId ?? ""
        )
    }
}

// MARK: - Timestamp parsing (ISO-8601, fractional-second tolerant)

/// Parses the API's ISO-8601 `replayed_at` strings, tolerating the fractional
/// seconds TimescaleDB sometimes emits. Formatters are built per call because
/// `ISO8601DateFormatter` is non-`Sendable` and the project compiles under
/// `SWIFT_STRICT_CONCURRENCY=complete`; audit parsing runs only at decode time.
public enum DLQAuditTime {
    public static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return date(from: value, fractionalSeconds: true)
            ?? date(from: value, fractionalSeconds: false)
    }

    private static func date(from value: String, fractionalSeconds: Bool) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractionalSeconds
            ? [.withInternetDateTime, .withFractionalSeconds]
            : [.withInternetDateTime]
        return formatter.date(from: value)
    }
}
