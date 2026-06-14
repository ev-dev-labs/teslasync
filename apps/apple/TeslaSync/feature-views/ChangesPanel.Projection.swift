//
//  ChangesPanel.Projection.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  The cached→projection adapter (a faithful port of the web source's per-row
//  rendering: `<TimeStamp format="absolute">`, the `field || '—'` em-dash
//  fallbacks, the localized operation token, and the `compact()` old/new previews)
//  plus the per-state presentation resolver. Pure value logic — no SwiftUI, no
//  networking — so every render branch is unit-testable.
//

import Foundation

// MARK: - Projection output value types

/// One change-audit row, fully formatted + localized for the table (web
/// `DataTable` row over `ChangesPanelFlagChange`). Pure value type so row formatting is
/// unit-tested without rendering the view.
public struct ChangeRowItem: Identifiable, Equatable, Sendable {
    public let id: Int
    public let changedAtText: String
    public let actorText: String
    public let flagKeyText: String
    public let operation: ChangesPanelFlagOperation
    public let operationLabel: String
    public let operationTone: ChangesOpTone
    public let oldValueText: String
    public let newValueText: String
    public let reasonText: String
}

/// The fully-resolved render model for the loaded state (web's table data).
public struct ChangesPanelProjection: Equatable, Sendable {
    public let rows: [ChangeRowItem]
}

// MARK: - Projection build (cached → projection)

public extension ChangesPanelProjection {
    /// Builds the projection from the cached changes, reproducing the web row
    /// rendering: an absolute `changed_at` (web `<TimeStamp format="absolute">`),
    /// the `actor || '—'` / `reason || '—'` em-dash fallbacks, the monospaced flag
    /// key (rendered verbatim — the web key column has no fallback), the localized
    /// operation token, and the `compact()` old/new previews. Rows preserve source
    /// order: the web passes `data={rows}` straight through, and the repo already
    /// returns newest-first (`ORDER BY changed_at DESC`).
    static func make(
        from changes: [ChangesPanelFlagChange],
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> ChangesPanelProjection {
        ChangesPanelProjection(rows: changes.map { row(from: $0, locale: locale, timeZone: timeZone) })
    }

    private static func row(
        from change: ChangesPanelFlagChange,
        locale: Locale,
        timeZone: TimeZone
    ) -> ChangeRowItem {
        ChangeRowItem(
            id: change.id,
            changedAtText: change.changedAt
                .map { absoluteDateTime($0, locale: locale, timeZone: timeZone) } ?? emDash,
            actorText: nonEmpty(change.actor),
            flagKeyText: change.flagKey,
            operation: change.operation,
            operationLabel: operationLabel(change.operation),
            operationTone: change.operation.tone,
            oldValueText: ChangesValuePreview.compact(change.oldValue),
            newValueText: ChangesValuePreview.compact(change.newValue),
            reasonText: nonEmpty(change.reason)
        )
    }
}

// MARK: - Formatting helpers (web `TimeStamp` / `field || '—'`)

public extension ChangesPanelProjection {
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

    /// The localized operation token shown in the chip (web Badge body
    /// `{row.operation}`).
    static func operationLabel(_ operation: ChangesPanelFlagOperation) -> String {
        ChangesPanelStrings.string(operation.localizationKey, operation.rawTag)
    }
}

// MARK: - Freshness + presentation (every state)

/// Freshness chrome shown in the header accessory (web freshness indicator).
public enum ChangesPanelFreshness: Equatable, Sendable {
    case live
    case stale
    case offline
}

/// The mutually-exclusive surface for the current data state — exhaustive so each
/// branch is unit-tested (loading / empty / offline-no-data / error / content). The
/// web shell only branches on `loading` / `rows.length`; this superset adds the
/// prompt's stale + offline + error chrome while preserving that core behavior.
public enum ChangesPanelPresentation: Equatable, Sendable {
    case loading
    case empty(scopedKey: String?)
    case offlineNoData
    case error(retryable: Bool)
    case content(ChangesPanelProjection, freshness: ChangesPanelFreshness, refreshing: Bool)
}

public extension ChangesPanelPresentation {
    /// Pure mapping from the cache-then-network load state (ADR-013) to a
    /// render-ready presentation. Keeps any cached rows visible behind a
    /// refresh / error; an empty resolved set becomes the web `EmptyState`
    /// (scoped/global message keyed on `scopedKey`).
    static func resolve(
        state: ChangesPanelLoadState<[ChangesPanelFlagChange]>,
        scopedKey: String?,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> ChangesPanelPresentation {
        func project(_ changes: [ChangesPanelFlagChange]) -> ChangesPanelProjection {
            ChangesPanelProjection.make(from: changes, locale: locale, timeZone: timeZone)
        }

        switch state {
        case .idle:
            return .loading
        case let .loading(cached, stale):
            guard let cached, !cached.isEmpty else { return .loading }
            return .content(project(cached), freshness: stale ? .stale : .live, refreshing: true)
        case let .loaded(changes, stale):
            return changes.isEmpty
                ? .empty(scopedKey: scopedKey)
                : .content(project(changes), freshness: stale ? .stale : .live, refreshing: false)
        case .empty:
            return .empty(scopedKey: scopedKey)
        case let .failed(error, cached, stale):
            return resolveFailure(error, cached: cached, stale: stale, scopedKey: scopedKey, project: project)
        }
    }

    private static func resolveFailure(
        _ error: ChangesPanelError,
        cached: [ChangesPanelFlagChange]?,
        stale: Bool,
        scopedKey _: String?,
        project: ([ChangesPanelFlagChange]) -> ChangesPanelProjection
    ) -> ChangesPanelPresentation {
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
