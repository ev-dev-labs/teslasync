//
//  AuditPanel.Projection.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's per-row
//  rendering: `<TimeStamp format="absolute">`, the `field || '—'` em-dash
//  fallbacks, and the localized result token) plus the per-state presentation
//  resolver. Pure value logic — no SwiftUI, no networking — so every render
//  branch is unit-testable.
//

import Foundation

// MARK: - Projection output value types

/// One audit row, fully formatted + localized for the table (web `DataTable` row
/// over `AuditPanelDLQReplayRecord`). Pure value type so row formatting is unit-tested.
public struct AuditRowItem: Identifiable, Equatable, Sendable {
    public let id: Int
    public let replayedAtText: String
    public let actorText: String
    public let dlqIdText: String
    public let result: AuditPanelDLQReplayResult
    public let resultLabel: String
    public let resultTone: AuditResultTone
    public let dstTopicText: String
    public let errorText: String
    public let traceIdText: String
}

/// The fully-resolved render model for the loaded state (web's table data).
public struct AuditPanelProjection: Equatable, Sendable {
    public let rows: [AuditRowItem]
}

// MARK: - Projection build (cached → projection)

public extension AuditPanelProjection {
    /// Builds the projection from the cached records, reproducing the web row
    /// rendering: an absolute `replayed_at` (web `<TimeStamp format="absolute">`),
    /// the `field || '—'` em-dash fallbacks, and the localized result token. Rows
    /// are ordered most-recent-first — the natural audit order, matching the repo
    /// (`dlq_replay_audit_repo.go` returns `ORDER BY replayed_at DESC`).
    static func make(
        from records: [AuditPanelDLQReplayRecord],
        now _: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> AuditPanelProjection {
        let rows = records
            .sorted { ($0.replayedAt ?? .distantPast) > ($1.replayedAt ?? .distantPast) }
            .map { record in row(from: record, locale: locale, timeZone: timeZone) }
        return AuditPanelProjection(rows: rows)
    }

    private static func row(
        from record: AuditPanelDLQReplayRecord,
        locale: Locale,
        timeZone: TimeZone
    ) -> AuditRowItem {
        AuditRowItem(
            id: record.id,
            replayedAtText: record.replayedAt
                .map { absoluteDateTime($0, locale: locale, timeZone: timeZone) } ?? emDash,
            actorText: nonEmpty(record.actor),
            dlqIdText: String(record.dlqId),
            result: record.result,
            resultLabel: resultLabel(record.result),
            resultTone: record.result.tone,
            dstTopicText: nonEmpty(record.dstTopic),
            errorText: nonEmpty(record.error),
            traceIdText: nonEmpty(record.traceId)
        )
    }
}

// MARK: - Formatting helpers (web `TimeStamp` / `field || '—'`)

public extension AuditPanelProjection {
    /// The shared em-dash the web renders for empty cells (`field || '—'`).
    static var emDash: String {
        "—"
    }

    /// Returns the trimmed value, or the em-dash when blank (web `field || '—'`).
    static func nonEmpty(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? emDash : trimmed
    }

    /// The localized absolute timestamp (web `<TimeStamp value format="absolute">`).
    static func absoluteDateTime(_ date: Date, locale: Locale, timeZone: TimeZone) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    /// The localized result token shown in the chip (web Badge body `{row.result}`).
    static func resultLabel(_ result: AuditPanelDLQReplayResult) -> String {
        AuditPanelStrings.string(result.localizationKey, result.rawTag)
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the status accessory (web freshness indicator).
public enum AuditPanelFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content).
/// The web shell only branches on `loading`/`rows.length`; this superset adds the
/// prompt's stale + offline + error chrome while preserving that core behavior.
public enum AuditPanelPresentation: Equatable, Sendable {
    case loading
    case empty(scoped: Bool)
    case offlineNoData
    case error(retryable: Bool)
    case content(AuditPanelProjection, freshness: AuditPanelFreshness, refreshing: Bool)
}

public extension AuditPanelPresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation. Keeps any cached rows visible behind a
    /// refresh/error; an empty resolved set becomes the web `EmptyState`
    /// (scoped/global message keyed on `scopedDlqId`).
    static func resolve(
        state: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>,
        scopedDlqId: Int?,
        now: Date = Date(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> AuditPanelPresentation {
        let scoped = scopedDlqId != nil

        func project(_ records: [AuditPanelDLQReplayRecord]) -> AuditPanelProjection {
            AuditPanelProjection.make(from: records, now: now, locale: locale, timeZone: timeZone)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(records, stale):
            return records.isEmpty
                ? .empty(scoped: scoped)
                : .content(project(records), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty(scoped: scoped)
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, scoped: scoped, project: project)
        }
    }

    private static func resolveFailure(
        _ error: AuditPanelError,
        cached: [AuditPanelDLQReplayRecord]?,
        stale: Bool,
        scoped _: Bool,
        project: ([AuditPanelDLQReplayRecord]) -> AuditPanelProjection
    ) -> AuditPanelPresentation {
        if error == .offline {
            guard let cached, !cached.isEmpty else { return .offlineNoData }
            return .content(project(cached), freshness: .offline, refreshing: false)
        }
        if let cached, !cached.isEmpty {
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: false)
        }
        return .error(retryable: error.isRetryable)
    }
}
