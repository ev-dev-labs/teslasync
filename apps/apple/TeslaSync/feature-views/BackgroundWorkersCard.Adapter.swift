//
//  BackgroundWorkersCard.Adapter.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  The testable projection core for the Background-workers card — the SwiftUI
//  parity of features/system/components/status/BackgroundWorkersCard.tsx plus the
//  leaf helpers it leans on (groupByName, severityClasses, instanceClasses,
//  shortHost, fmtLatency) and the two-axis summary maths the web card computes
//  inline. Everything here is pure + dependency-free (no store, no bundle, no
//  rendered view) so the wire decode, the host normalisation, the latency
//  rounding, the per-name grouping + severity rollup, the summary, and the
//  VoiceOver phrases are all unit tested in isolation.
//

import Foundation

// MARK: - Instance status (web WorkerStatus['status'] union + instanceClasses)

/// The per-instance health the backend reports for one worker replica (web
/// `'healthy' | 'unhealthy' | 'down'`). Decoding is lenient: an unrecognised
/// value degrades to `.down`, mirroring the web `instanceClasses` fall-through
/// where anything that is not `healthy` / `unhealthy` renders as "down" rather
/// than blanking the row.
public enum WorkerInstanceStatus: String, Sendable, Equatable, CaseIterable, Decodable {
    case healthy
    case unhealthy
    case down

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = WorkerInstanceStatus(rawValue: raw) ?? .down
    }

    /// Lenient mapping from an arbitrary backend string (web template-literal key).
    public static func parse(_ raw: String) -> WorkerInstanceStatus {
        WorkerInstanceStatus(rawValue: raw) ?? .down
    }
}

// MARK: - Group severity (web Severity union + severityClasses)

/// The rolled-up severity for a worker *name* across its 1..N instances (web
/// `'healthy' | 'degraded' | 'down' | 'unknown'`). `unknown` is the empty-group
/// fallback the web `severityClasses` carries; grouping never emits it for a
/// non-empty group, but it is kept so the tone/label map is total.
public enum WorkerGroupSeverity: String, Sendable, Equatable, CaseIterable {
    case healthy
    case degraded
    case down
    case unknown
}

// MARK: - Wire models (web WorkerStatus / WorkersHealth)

/// One worker instance row from GET /api/v1/system/workers (web `WorkerStatus`).
/// `latencyMs` is optional because the defensive web UI tolerates a missing
/// `latency_ms`, and `error` is only present when a probe failed. The snake_case
/// `CodingKeys` mirror the JSON tags exactly (the camelCase-vs-snake_case
/// mismatch is a recurring bug source, so it is covered by a decode test).
public struct WorkerInstance: Identifiable, Equatable, Sendable, Decodable {
    public let name: String
    public let host: String
    public let status: WorkerInstanceStatus
    public let latencyMs: Double?
    public let error: String?

    /// Stable identity for `ForEach` — the web row key `${name}::${host}`.
    public var id: String {
        "\(name)::\(host)"
    }

    enum CodingKeys: String, CodingKey {
        case name
        case host
        case status
        case latencyMs = "latency_ms"
        case error
    }

    public init(
        name: String,
        host: String,
        status: WorkerInstanceStatus,
        latencyMs: Double? = nil,
        error: String? = nil
    ) {
        self.name = name
        self.host = host
        self.status = status
        self.latencyMs = latencyMs
        self.error = error
    }
}

/// The GET /api/v1/system/workers envelope (web `WorkersHealth`). `total` /
/// `healthyCount` are decoded leniently (defaulting to values derived from the
/// rows) because the card itself recomputes both axes from `workers`; this keeps
/// a partial payload from throwing.
public struct WorkersHealthSnapshot: Equatable, Sendable, Decodable {
    public let workers: [WorkerInstance]
    public let total: Int
    public let healthyCount: Int

    enum CodingKeys: String, CodingKey {
        case workers
        case total
        case healthyCount = "healthy_count"
    }

    public init(workers: [WorkerInstance], total: Int? = nil, healthyCount: Int? = nil) {
        self.workers = workers
        self.total = total ?? workers.count
        self.healthyCount = healthyCount ?? workers.count(where: { $0.status == .healthy })
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let rows = try container.decodeIfPresent([WorkerInstance].self, forKey: .workers) ?? []
        let decodedTotal = try container.decodeIfPresent(Int.self, forKey: .total)
        let decodedHealthy = try container.decodeIfPresent(Int.self, forKey: .healthyCount)
        self.init(workers: rows, total: decodedTotal, healthyCount: decodedHealthy)
    }

    /// Decodes the snapshot from raw API bytes (production source path). Returns
    /// `nil` only when the bytes are not the expected JSON object.
    public static func decode(_ data: Data) -> WorkersHealthSnapshot? {
        try? JSONDecoder().decode(WorkersHealthSnapshot.self, from: data)
    }
}

// MARK: - Projections (web grouped rows + summary)

/// The view-ready projection of one instance row — the native mirror of the
/// per-row fields the web renders: the short host (with the full URL kept for the
/// VoiceOver / title affordance), the status, the rounded latency, and the probe
/// error. Labels stay in the view so they resolve through the i18n facade.
public struct WorkerInstanceProjection: Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let fullHost: String
    public let shortHost: String
    public let status: WorkerInstanceStatus
    public let latencyMs: Int?
    public let error: String?

    public init(
        id: String,
        name: String,
        fullHost: String,
        shortHost: String,
        status: WorkerInstanceStatus,
        latencyMs: Int?,
        error: String?
    ) {
        self.id = id
        self.name = name
        self.fullHost = fullHost
        self.shortHost = shortHost
        self.status = status
        self.latencyMs = latencyMs
        self.error = error
    }

    /// `true` when the red error box renders (web `inst.error && …`).
    public var hasError: Bool {
        !(error?.isEmpty ?? true)
    }
}

/// The view-ready projection of one worker *name* group — the native mirror of
/// the web `WorkerGroup`: the ordered instances, the healthy/total rollup, and
/// the severity that drives the group dot + chip tone.
public struct WorkerGroupProjection: Identifiable, Equatable, Sendable {
    public let name: String
    public let instances: [WorkerInstanceProjection]
    public let healthyCount: Int
    public let total: Int
    public let severity: WorkerGroupSeverity

    public var id: String {
        name
    }

    /// `true` when the group is horizontally scaled (web `g.total > 1`).
    public var isMulti: Bool {
        total > 1
    }

    public init(
        name: String,
        instances: [WorkerInstanceProjection],
        healthyCount: Int,
        total: Int,
        severity: WorkerGroupSeverity
    ) {
        self.name = name
        self.instances = instances
        self.healthyCount = healthyCount
        self.total = total
        self.severity = severity
    }
}

/// The two-axis top-line summary (web `totalInstances` / `healthyInstances` /
/// `groupCount` / `healthyGroups` / `multiInstanceGroups`). The key
/// differentiator for horizontally-scaled deployments is types-vs-instances, so
/// both counts are surfaced.
public struct WorkersSummary: Equatable, Sendable {
    public let healthyGroups: Int
    public let groupCount: Int
    public let healthyInstances: Int
    public let totalInstances: Int
    public let multiInstanceGroups: Int

    public init(
        healthyGroups: Int,
        groupCount: Int,
        healthyInstances: Int,
        totalInstances: Int,
        multiInstanceGroups: Int
    ) {
        self.healthyGroups = healthyGroups
        self.groupCount = groupCount
        self.healthyInstances = healthyInstances
        self.totalInstances = totalInstances
        self.multiInstanceGroups = multiInstanceGroups
    }

    /// `true` when at least one worker name runs more than one instance (web
    /// `multiInstanceGroups > 0`); drives the "Replicated" readout + the
    /// scale-callout footer visibility.
    public var isReplicated: Bool {
        multiInstanceGroups > 0
    }
}

// MARK: - Adapter (web groupByName / shortHost / fmtLatency + summary)

/// Pure transforms from the decoded snapshot to the grouped projection + summary.
/// Unit tested in isolation; no store, no bundle, no view.
public enum WorkersAdapter {
    /// The em-dash sentinel for a missing latency (web `fmtLatency` fallback).
    public static let dash = "—"

    /// Strips `http(s)://` and a trailing `/healthz` so the host column is
    /// readable, keeping the full URL available for the title/VoiceOver
    /// affordance (web `shortHost`).
    public static func shortHost(_ rawURL: String) -> String {
        var trimmed = rawURL.replacingOccurrences(
            of: "^https?://",
            with: "",
            options: .regularExpression
        )
        trimmed = trimmed.replacingOccurrences(
            of: "/healthz/?$",
            with: "",
            options: .regularExpression
        )
        return trimmed
    }

    /// Rounds a latency to whole milliseconds, returning `nil` for a nullish or
    /// non-finite value (web `fmtLatency` → em-dash branch). The view applies the
    /// " ms" unit through the i18n facade.
    public static func roundedLatencyMs(_ milliseconds: Double?) -> Int? {
        guard let milliseconds, milliseconds.isFinite else { return nil }
        return Int(milliseconds.rounded())
    }

    /// Groups the flat instance list by `name`, projects each row, rolls up the
    /// per-group severity, and sorts the groups by name — the native port of the
    /// web `groupByName`. Severity is `healthy` when every instance is healthy,
    /// `down` when every instance is down, else `degraded`.
    public static func group(_ workers: [WorkerInstance]) -> [WorkerGroupProjection] {
        var order: [String] = []
        var buckets: [String: [WorkerInstance]] = [:]
        for worker in workers {
            if buckets[worker.name] == nil {
                buckets[worker.name] = []
                order.append(worker.name)
            }
            buckets[worker.name]?.append(worker)
        }

        let groups = order.map { name -> WorkerGroupProjection in
            let instances = buckets[name] ?? []
            let projected = instances.map { instance in
                WorkerInstanceProjection(
                    id: instance.id,
                    name: instance.name,
                    fullHost: instance.host,
                    shortHost: shortHost(instance.host),
                    status: instance.status,
                    latencyMs: roundedLatencyMs(instance.latencyMs),
                    error: (instance.error?.isEmpty ?? true) ? nil : instance.error
                )
            }
            let healthy = instances.count(where: { $0.status == .healthy })
            return WorkerGroupProjection(
                name: name,
                instances: projected,
                healthyCount: healthy,
                total: instances.count,
                severity: severity(of: instances)
            )
        }

        return groups.sorted { $0.name < $1.name }
    }

    /// Rolls up a group's severity (web ternary inside `groupByName`).
    public static func severity(of instances: [WorkerInstance]) -> WorkerGroupSeverity {
        guard !instances.isEmpty else { return .unknown }
        if instances.allSatisfy({ $0.status == .healthy }) { return .healthy }
        if instances.allSatisfy({ $0.status == .down }) { return .down }
        return .degraded
    }

    /// Computes the two-axis summary from the grouped projection (web top-line
    /// counts). Derived purely from the groups so it stays in lock-step with the
    /// rendered rows.
    public static func summary(of groups: [WorkerGroupProjection]) -> WorkersSummary {
        WorkersSummary(
            healthyGroups: groups.count(where: { $0.severity == .healthy }),
            groupCount: groups.count,
            healthyInstances: groups.reduce(0) { $0 + $1.healthyCount },
            totalInstances: groups.reduce(0) { $0 + $1.total },
            multiInstanceGroups: groups.filter(\.isMulti).count
        )
    }
}

// MARK: - Accessibility summaries (testable seam)

/// Builds the combined VoiceOver phrases from already-resolved display strings.
/// Pure + public so the spoken content is asserted without rendering the view;
/// empties are dropped so a phrase never reads a stray comma.
public enum WorkersAccessibility {
    public static func groupSummary(name: String, status: String, count: String) -> String {
        join([name, status, count])
    }

    public static func instanceSummary(
        host: String,
        status: String,
        latency: String?,
        error: String?
    ) -> String {
        join([host, status, latency, error])
    }

    private static func join(_ fragments: [String?]) -> String {
        fragments
            .compactMap { fragment in
                guard let fragment, !fragment.isEmpty else { return nil }
                return fragment
            }
            .joined(separator: ", ")
    }
}
