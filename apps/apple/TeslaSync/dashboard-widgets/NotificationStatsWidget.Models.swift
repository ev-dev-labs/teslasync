//
//  NotificationStatsWidget.Models.swift
//  TeslaSync — P4 dashboard widget · 0069 · NotificationStatsWidget (Apple)
//
//  Domain value types ported from the web source's data contracts
//  (api/types.ts `NotificationStats` / `NotificationLog`) plus the snake-case
//  decode adapter the production source uses to project the cached DTOs. Pure
//  Foundation — no SwiftUI, no Shared xcframework — so it host-compiles and the
//  cached→projection adapter is unit-testable in isolation.
//

import Foundation

// MARK: - NotificationStats (web `NotificationStats`, GET /notifications/stats)

/// Aggregate delivery counters for the last window (web `NotificationStats`).
public struct NotificationStats: Equatable, Sendable {
    public var totalSent: Int
    public var sent: Int
    public var failed: Int
    public var pending: Int
    public var totalChannels: Int
    public var enabledChannels: Int

    public init(
        totalSent: Int = 0,
        sent: Int = 0,
        failed: Int = 0,
        pending: Int = 0,
        totalChannels: Int = 0,
        enabledChannels: Int = 0
    ) {
        self.totalSent = totalSent
        self.sent = sent
        self.failed = failed
        self.pending = pending
        self.totalChannels = totalChannels
        self.enabledChannels = enabledChannels
    }

    /// The delivery rate as a 0–100 percentage (web `sent / total_sent * 100`),
    /// guarding division by zero exactly like the source.
    public var deliveryRate: Double {
        totalSent > 0 ? (Double(sent) / Double(totalSent)) * 100 : 0
    }
}

// MARK: - NotificationLogStatus (web `status` union)

/// Delivery status of one notification (web `NotificationLog.status` union),
/// with an `unknown` fallback so an unexpected server value never crashes.
public enum NotificationLogStatus: String, Sendable, CaseIterable {
    case sent
    case failed
    case pending
    case deferredDnd
    case unknown

    /// Maps the snake-case wire value (`deferred_dnd`) to a case.
    public init(rawTag: String?) {
        switch (rawTag ?? "").lowercased() {
        case "sent": self = .sent
        case "failed": self = .failed
        case "pending": self = .pending
        case "deferred_dnd", "deferreddnd": self = .deferredDnd
        default: self = .unknown
        }
    }

    /// The wire/display token the web row renders verbatim (`log.status`).
    public var rawTag: String {
        switch self {
        case .sent: "sent"
        case .failed: "failed"
        case .pending: "pending"
        case .deferredDnd: "deferred_dnd"
        case .unknown: "—"
        }
    }
}

// MARK: - NotificationLog (web `NotificationLog`, GET /notifications/logs)

/// One delivery-log row (web `NotificationLog`). Only the fields the widget
/// reads are modeled; `createdAt` is optional because a malformed timestamp
/// must degrade gracefully rather than drop the row.
public struct NotificationLog: Equatable, Sendable, Identifiable {
    public let id: Int
    public var title: String
    public var message: String
    public var status: NotificationLogStatus
    public var createdAt: Date?

    public init(
        id: Int,
        title: String = "",
        message: String = "",
        status: NotificationLogStatus = .unknown,
        createdAt: Date? = nil
    ) {
        self.id = id
        self.title = title
        self.message = message
        self.status = status
        self.createdAt = createdAt
    }
}

// MARK: - NotificationStatsData (the coalesced input the source pushes)

/// The two web queries (`useNotificationStats` + `useNotificationLogs`) coalesced
/// into one snapshot. The web shows content iff `stats` is present, so the data is
/// keyed on stats and carries logs as an auxiliary (possibly empty) array.
public struct NotificationStatsData: Equatable, Sendable {
    public var stats: NotificationStats
    public var logs: [NotificationLog]

    public init(stats: NotificationStats, logs: [NotificationLog] = []) {
        self.stats = stats
        self.logs = logs
    }
}

// MARK: - Decode adapter (snake-case DTO → value types)

public extension NotificationStats {
    private struct DTO: Decodable {
        let totalSent: Int?
        let sent: Int?
        let failed: Int?
        let pending: Int?
        let totalChannels: Int?
        let enabledChannels: Int?
    }

    /// Decodes the `/notifications/stats` snake-case JSON object.
    static func decode(fromJSONString json: String) -> NotificationStats? {
        guard let data = json.data(using: .utf8) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let dto = try? decoder.decode(DTO.self, from: data) else { return nil }
        return NotificationStats(
            totalSent: dto.totalSent ?? 0,
            sent: dto.sent ?? 0,
            failed: dto.failed ?? 0,
            pending: dto.pending ?? 0,
            totalChannels: dto.totalChannels ?? 0,
            enabledChannels: dto.enabledChannels ?? 0
        )
    }

    /// Bridges a shared-core payload (a JSON `String`) to the value type. The
    /// production `NotificationStatsSource` hands the cached DTO here.
    static func decode(fromSharedPayload payload: Any) -> NotificationStats? {
        if let json = payload as? String { return decode(fromJSONString: json) }
        return nil
    }
}

public extension NotificationLog {
    private struct DTO: Decodable {
        let id: Int
        let title: String?
        let message: String?
        let status: String?
        let createdAt: String?
    }

    /// Decodes the `/notifications/logs` snake-case JSON array.
    static func decodeList(fromJSONString json: String) -> [NotificationLog] {
        guard let data = json.data(using: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let dtos = try? decoder.decode([DTO].self, from: data) else { return [] }
        return dtos.map { dto in
            NotificationLog(
                id: dto.id,
                title: dto.title ?? "",
                message: dto.message ?? "",
                status: NotificationLogStatus(rawTag: dto.status),
                createdAt: NotificationLogTime.parse(dto.createdAt)
            )
        }
    }
}

// MARK: - Timestamp parsing (ISO-8601, fractional-second tolerant)

/// Parses the API's ISO-8601 `created_at` strings, tolerating the fractional
/// seconds TimescaleDB sometimes emits.
public enum NotificationLogTime {
    private nonisolated(unsafe) static let withFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private nonisolated(unsafe) static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    public static func parse(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return withFraction.date(from: value) ?? plain.date(from: value)
    }
}
