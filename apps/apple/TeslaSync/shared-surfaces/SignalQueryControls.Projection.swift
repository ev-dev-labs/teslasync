//
//  SignalQueryControls.Projection.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The pure decision logic + the cached-inputs → view-projection map + the VoiceOver summary seam,
//  split out of the data layer (one file ≤ 400 lines per the SwiftLint contract). Foundation-only and
//  view-free, so the "Query" enablement, the table render axis, the contextual empty hint, and the
//  spoken summary are unit tested without a view — and the live model derives the very same flags
//  through `SignalQueryLogic`, so the projection and the model can never drift (P4 acceptance:
//  *adapter unit test (cached → projection)*).
//

import Foundation

// MARK: - Contextual empty hint (P4 friendly empty state)

/// Why the surface cannot run a query yet — surfaced as the friendly hint under the controls so the
/// resting panel is never a blank/confusing surface. Mirrors the single web precondition (at least
/// one selected signal) the parent page gates `onQuery` on.
public enum SignalQueryHint: Equatable, Sendable {
    case selectSignal
}

// MARK: - Pure decision logic (web component branches)

/// The pure, view-free decision logic ported from the web components. Each function is a direct
/// translation of a web predicate so the view is a pure function of these and every branch is tested.
public enum SignalQueryLogic {
    /// Whether the "Query" action can run — web parent requires at least one selected signal before
    /// it issues the history request.
    public static func canQuery(selectedCount: Int) -> Bool {
        selectedCount > 0
    }

    /// Web `QueryControls.disabled` (+ the native leaf contract): the button is disabled with no
    /// selection, while a query is already in flight, or while offline (no request is possible).
    public static func queryDisabled(
        selectedCount: Int,
        tableLoading: Bool,
        connection: SignalQueryConnection
    ) -> Bool {
        !canQuery(selectedCount: selectedCount) || tableLoading || connection == .offline
    }

    /// Web `SignalMultiSelect.addSignal` cap: a new signal can be added only below the optional max.
    public static func canAddSignal(selectedCount: Int, maxSignals: Int?) -> Bool {
        guard let maxSignals else { return true }
        return selectedCount < maxSignals
    }

    /// The results-table render axis (web `SignalDataTable`): the skeleton while loading, the error
    /// state for a failed query, the friendly empty state for a resolved-but-empty result, else rows.
    public static func tableState(
        loading: Bool,
        rowCount: Int,
        errorMessage: String?
    ) -> SignalQueryTableState {
        if loading { return .loading }
        if let errorMessage, !errorMessage.isEmpty { return .error(errorMessage) }
        if rowCount == 0 { return .empty }
        return .rows
    }

    /// The contextual hint shown when a query cannot run for an input reason — the friendly "select a
    /// signal" nudge so the controls are never a dead surface. Nil once a signal is chosen.
    public static func emptyHint(selectedCount: Int) -> SignalQueryHint? {
        canQuery(selectedCount: selectedCount) ? nil : .selectSignal
    }
}

// MARK: - View projection (cached inputs → render decisions)

/// The pure projection of the surface's cached inputs into the render decisions the view switches on
/// — the testable "adapter" boundary. Holds no SwiftUI and no I/O; the model derives the same flags
/// through `SignalQueryLogic` + the `Signal*` helpers, so the projection is the single source of truth.
public struct SignalQueryProjection: Equatable, Sendable {
    public let availableState: SignalQueryAvailableState
    public let connection: SignalQueryConnection
    public let canQuery: Bool
    public let queryDisabled: Bool
    public let tableState: SignalQueryTableState
    public let emptyHint: SignalQueryHint?
    public let activePresetHours: Int?
    public let page: Int
    public let totalPages: Int
    public let total: Int
    public let canGoPrevious: Bool
    public let canGoNext: Bool
    public let showsPager: Bool

    public init(
        availableState: SignalQueryAvailableState,
        connection: SignalQueryConnection,
        canQuery: Bool,
        queryDisabled: Bool,
        tableState: SignalQueryTableState,
        emptyHint: SignalQueryHint?,
        activePresetHours: Int?,
        page: Int,
        totalPages: Int,
        total: Int,
        canGoPrevious: Bool,
        canGoNext: Bool,
        showsPager: Bool
    ) {
        self.availableState = availableState
        self.connection = connection
        self.canQuery = canQuery
        self.queryDisabled = queryDisabled
        self.tableState = tableState
        self.emptyHint = emptyHint
        self.activePresetHours = activePresetHours
        self.page = page
        self.totalPages = totalPages
        self.total = total
        self.canGoPrevious = canGoPrevious
        self.canGoNext = canGoNext
        self.showsPager = showsPager
    }

    /// Projects the coalesced available + result snapshots (plus the current selection + range) into
    /// the render decisions, reusing `SignalQueryLogic` + the pure helpers so the projection is the
    /// single mapping the model also consumes.
    public static func make(
        available: SignalQueryAvailableSnapshot,
        result: SignalQueryResultSnapshot,
        selectedCount: Int,
        from: Date,
        to: Date
    ) -> SignalQueryProjection {
        let pagination = result.pagination
        let tableState = SignalQueryLogic.tableState(
            loading: result.loading,
            rowCount: result.rows.count,
            errorMessage: result.errorMessage
        )
        return SignalQueryProjection(
            availableState: available.state,
            connection: available.connection,
            canQuery: SignalQueryLogic.canQuery(selectedCount: selectedCount),
            queryDisabled: SignalQueryLogic.queryDisabled(
                selectedCount: selectedCount,
                tableLoading: result.loading,
                connection: available.connection
            ),
            tableState: tableState,
            emptyHint: SignalQueryLogic.emptyHint(selectedCount: selectedCount),
            activePresetHours: SignalTimeRange.matchPreset(from: from, to: to),
            page: pagination.page,
            totalPages: pagination.totalPages,
            total: pagination.total,
            canGoPrevious: SignalPaging.canGoPrevious(page: pagination.page),
            canGoNext: SignalPaging.canGoNext(page: pagination.page, totalPages: pagination.totalPages),
            showsPager: SignalPaging.showsPager(totalPages: pagination.totalPages)
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary for the panel from already-localised parts, so the spoken content is
/// asserted without rendering the view. Mirrors the reading order: the title, the selected-signal
/// count, the freshness, and the result-table status (loading / error / N records).
public enum SignalQueryAccessibility {
    /// The localised label set the summary interleaves with the live counts.
    public struct Labels: Sendable, Equatable {
        public let title: String
        public let selectedSignals: String
        public let live: String
        public let stale: String
        public let offline: String
        public let loadingResults: String
        public let resultsError: String
        public let records: String
        public let noResults: String

        public init(
            title: String,
            selectedSignals: String,
            live: String,
            stale: String,
            offline: String,
            loadingResults: String,
            resultsError: String,
            records: String,
            noResults: String
        ) {
            self.title = title
            self.selectedSignals = selectedSignals
            self.live = live
            self.stale = stale
            self.offline = offline
            self.loadingResults = loadingResults
            self.resultsError = resultsError
            self.records = records
            self.noResults = noResults
        }
    }

    public static func summary(
        labels: Labels,
        selectedCount: Int,
        connection: SignalQueryConnection,
        tableState: SignalQueryTableState,
        total: Int
    ) -> String {
        var parts: [String] = [labels.title]
        parts.append("\(labels.selectedSignals): \(selectedCount)")
        switch connection {
        case .live: parts.append(labels.live)
        case .stale: parts.append(labels.stale)
        case .offline: parts.append(labels.offline)
        }
        switch tableState {
        case .loading: parts.append(labels.loadingResults)
        case let .error(message): parts.append("\(labels.resultsError) \(message)")
        case .empty: parts.append(labels.noResults)
        case .rows: parts.append("\(total) \(labels.records)")
        }
        return parts.joined(separator: ". ")
    }
}
