//
//  SignalQueryControls.Model.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  Signal Query Controls surface. The view binds through `SignalQueryControlsModel`; no networking
//  lives in the view. The web source's only data fetch is the `useQuery(['signal-available'])` list
//  the multi-select reads; the parent page wires the "Query" submit to fetch + adapt the history rows
//  the table renders. This model mirrors both behind one `SignalQueryControlsSource`: available
//  signals arrive via `onAvailable`, executed-query rows via `onResult`, and the model owns the form
//  state (selection, range, page size) the controls bind to.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "SignalQueryControls" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; in test / preview bundles `NSLocalizedString`
/// returns the `value:` fallback, keeping the projection + assertions deterministic.
public enum SignalQueryControlsStrings {
    public static let table = "SignalQueryControls"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Web `t('signalQuery.preset.aria', '{{label}} time range', { label })` — resolves the template
    /// then substitutes the `{{label}}` token, reproducing the i18next interpolation faithfully.
    public static func presetAria(label: String) -> String {
        string("signalQuery.preset.aria", "{{label}} time range")
            .replacingOccurrences(of: "{{label}}", with: label)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SignalQueryControlsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSignalQueryControlsTelemetry: SignalQueryControlsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the `/signals/available`
/// gate query (→ `onAvailable`) and the `/signals/{vid}/{name}/history` fetch + `adaptSignalHistoryResp`
/// (→ `onResult`); previews and tests use `InMemorySignalQueryControlsSource`. The view never talks
/// to the network directly.
@MainActor
public protocol SignalQueryControlsSource: AnyObject {
    /// The available-signals snapshot (web `useQuery` result + connectivity).
    var onAvailable: (@MainActor (SignalQueryAvailableSnapshot) -> Void)? { get set }
    /// The executed-query result snapshot (web parent fetch + adapter → `SignalDataTable`).
    var onResult: (@MainActor (SignalQueryResultSnapshot) -> Void)? { get set }

    func start()
    func stop()
    /// Re-request the available-signals snapshot (header refresh + error retry).
    func refresh()
    /// Web parent `onQuery` — fetch + adapt the history rows for the given parameters.
    func runQuery(_ request: SignalQueryRequest)
}

// MARK: - Observable model

/// The surface's observable view-model. Subscribes to a `SignalQueryControlsSource`, owns the form
/// state the controls bind to (selected signals, the From/To range, the page size), tracks the
/// available-signals fetch + connectivity + the executed-query result, runs queries through the
/// source, auto-refreshes once when the available feed turns stale, and emits `view.opened` once.
/// Derives every view flag through `SignalQueryProjection` so the live model and the testable
/// projection never diverge.
@MainActor
@Observable
public final class SignalQueryControlsModel {
    /// The selected signal names (web `selected` prop) — the multi-select chips.
    public private(set) var selected: [String]
    /// The range start the From picker binds to (web `fromStr`).
    public var from: Date
    /// The range end the To picker binds to (web `toStr`).
    public var to: Date
    /// The rows-per-page size the Rows select binds to (web `perPage`).
    public var perPage: Int

    /// The available-signals snapshot (web `useQuery` result + connectivity).
    public private(set) var available: SignalQueryAvailableSnapshot
    /// The executed-query result snapshot (rows + pagination + table loading / error).
    public private(set) var result: SignalQueryResultSnapshot

    /// The scoped vehicle id (web `vehicleId` prop).
    public let vehicleID: Int64
    /// The optional selection cap (web `maxSignals` prop).
    public let maxSignals: Int?

    @ObservationIgnored private let source: any SignalQueryControlsSource
    @ObservationIgnored private let telemetry: any SignalQueryControlsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastRequest: SignalQueryRequest?

    public init(
        vehicleID: Int64,
        source: any SignalQueryControlsSource,
        telemetry: any SignalQueryControlsTelemetry = OSLogSignalQueryControlsTelemetry(),
        selected: [String] = [],
        perPage: Int = 50,
        maxSignals: Int? = nil,
        anchor: Date = Date()
    ) {
        self.vehicleID = vehicleID
        self.source = source
        self.telemetry = telemetry
        self.selected = selected
        self.maxSignals = maxSignals
        self.perPage = perPage
        let initialRange = SignalTimeRange.range(hours: 24, anchor: anchor)
        from = initialRange.from
        to = initialRange.to
        available = SignalQueryAvailableSnapshot(state: .loading)
        result = SignalQueryResultSnapshot(
            pagination: SignalHistoryPagination(page: 1, perPage: perPage, total: 0, totalPages: 0)
        )
        source.onAvailable = { [weak self] snapshot in self?.applyAvailable(snapshot) }
        source.onResult = { [weak self] snapshot in self?.result = snapshot }
    }

    // MARK: Derived view-state (the single projection the view + tests share)

    /// The full view projection of the current cached inputs — the view reads its fields; the adapter
    /// test asserts the same mapping.
    public var projection: SignalQueryProjection {
        SignalQueryProjection.make(
            available: available,
            result: result,
            selectedCount: selected.count,
            from: from,
            to: to
        )
    }

    /// The available signal names the multi-select lists (web `availableSignals ?? []`).
    public var availableSignals: [String] {
        available.signals
    }

    /// The table rows (web `SignalDataTable` `rows`).
    public var rows: [SignalLogEntry] {
        result.rows
    }

    /// The connectivity axis (P4 leaf freshness chip + banner).
    public var connection: SignalQueryConnection {
        available.connection
    }

    /// The available-signals fetch lifecycle (web `useQuery` status).
    public var availableState: SignalQueryAvailableState {
        available.state
    }

    /// The results-table render axis.
    public var tableState: SignalQueryTableState {
        projection.tableState
    }

    /// The server pagination metadata (web `SignalDataTable` props).
    public var pagination: SignalHistoryPagination {
        result.pagination
    }

    /// Web `QueryControls.disabled` (+ offline leaf contract).
    public var queryDisabled: Bool {
        projection.queryDisabled
    }

    /// The active quick-range preset's hours, or nil for a custom range (web `activePresetHours`).
    public var activePresetHours: Int? {
        projection.activePresetHours
    }

    /// The contextual disabled-reason hint (P4 friendly empty state), or nil when ready.
    public var emptyHint: SignalQueryHint? {
        projection.emptyHint
    }

    /// The case-insensitive available-signal list for the current search (web `filtered` memo).
    public func filteredAvailable(search: String) -> [String] {
        SignalAvailableFilter.filter(available: available.signals, selected: selected, search: search)
    }

    // MARK: Lifecycle

    /// Begins observing and emits `view.opened` once. Idempotent across appear/disappear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SignalQueryControlsSurface.slug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the available-signals snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Actions (web component handlers)

    /// Web `SignalMultiSelect.addSignal`: append the signal when it is new and below the optional cap.
    public func addSignal(_ signal: String) {
        guard SignalQueryLogic.canAddSignal(selectedCount: selected.count, maxSignals: maxSignals) else {
            return
        }
        guard !selected.contains(signal) else { return }
        selected.append(signal)
    }

    /// Web `SignalMultiSelect.removeSignal`: drop the signal from the selection.
    public func removeSignal(_ signal: String) {
        selected.removeAll { $0 == signal }
    }

    /// Web `DateTimeRangeControls.onPreset`: anchor a (now − hours, now) range for the preset.
    public func applyPreset(hours: Int, anchor: Date = Date()) {
        let range = SignalTimeRange.range(hours: hours, anchor: anchor)
        from = range.from
        to = range.to
    }

    /// Web `QueryControls.onQuery`: run the history query for the current selection / range / size,
    /// resetting to the first page. A guarded no-op when no signal is selected.
    public func runQuery() {
        guard SignalQueryLogic.canQuery(selectedCount: selected.count) else { return }
        execute(page: 1)
    }

    /// Web `SignalDataTable.onPageChange`: fetch the (clamped) page, preserving the active query.
    public func goToPage(_ page: Int) {
        let clamped = SignalPaging.clamp(page: page, totalPages: result.pagination.totalPages)
        execute(page: clamped)
    }

    /// Retries the last query (the table's error-state retry); a no-op before any query has run.
    public func retryQuery() {
        guard let lastRequest else { return }
        execute(page: lastRequest.page)
    }

    private func execute(page: Int) {
        var pending = result
        pending.loading = true
        pending.errorMessage = nil
        result = pending
        let request = SignalQueryRequest(
            signals: selected,
            from: from,
            to: to,
            perPage: perPage,
            page: page
        )
        lastRequest = request
        source.runQuery(request)
    }

    // MARK: Source callbacks

    private func applyAvailable(_ snapshot: SignalQueryAvailableSnapshot) {
        let previous = available.connection
        available = snapshot
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}
