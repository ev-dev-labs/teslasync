//
//  SignalHistoryTable.Model.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the signal-history table. The view binds through `SignalHistoryModel`;
//  no networking lives in the view. The web source (SignalHistoryTable.tsx) is a pure
//  presentational leaf — its only hooks are `useTranslation` + `useDateFormat`; it
//  receives `rows` / `selectedSignals` / `page` / `pageSize` / `totalRows` / `loading`
//  as props from its parent page (SignalLogViewerPage · SignalExplorerPage ·
//  SignalsWorkspacePage), and notifies page changes through the `onPageChange` prop.
//  So the native `SignalHistorySource` carries that parent prop snapshot and forwards
//  page requests, rather than issuing HTTP itself; the projection is the same one the
//  web render performs.
//
//  States: the web leaf's own branches are `loading ? skeleton : (rows.length ? table :
//  empty)`. On top of those, this surface honours the P4 leaf contract (the same one
//  AcDcStatsPanel/0096 + FlagsTable/0031 ship): a `phase`
//  (loading / error / data / empty) fed by the parent's query state, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner with
//  a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here (not on
/// the SwiftUI view) so the model + tests reference it without importing SwiftUI.
public enum SignalHistoryDiagnostics {
    public static let surface = "SignalHistoryTable"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol SignalHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The
/// slug is a static, non-identifying constant, so the log line is redaction-safe.
public struct OSLogSignalHistoryTelemetry: SignalHistoryTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum SignalHistoryConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the parent signal-history query)

/// One coalesced snapshot of the table's inputs — the native mirror of the web props
/// (`rows`, `selectedSignals`, `page`, `pageSize`, `totalRows`, `loading`, `title`,
/// `showHeaderMeta`, `expandable`) plus the parent surface's lifecycle (an error message
/// and connectivity). `page` is 1-based, exactly like the web `Pagination` contract.
public struct SignalHistoryInput: Sendable, Equatable {
    public var rows: [SignalLogInput]
    public var selectedSignals: [String]
    public var page: Int
    public var pageSize: Int
    public var totalRows: Int
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: SignalHistoryConnection
    public var title: String?
    public var showHeaderMeta: Bool
    public var expandable: Bool

    public init(
        rows: [SignalLogInput] = [],
        selectedSignals: [String] = [],
        page: Int = 1,
        pageSize: Int = 25,
        totalRows: Int = 0,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: SignalHistoryConnection = .live,
        title: String? = nil,
        showHeaderMeta: Bool = true,
        expandable: Bool = true
    ) {
        self.rows = rows
        self.selectedSignals = selectedSignals
        self.page = page
        self.pageSize = pageSize
        self.totalRows = totalRows
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
        self.title = title
        self.showHeaderMeta = showHeaderMeta
        self.expandable = expandable
    }
}

// MARK: - Resolved render state (the web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the web render
/// (`loading ? skeleton : (rows.length ? table + pagination : empty)`), plus the native
/// error branch. `phase` selects the body; the projected rows + the pagination metadata
/// (page / pageSize / totalRows / pageCount) + the header config are pre-computed so the
/// view is a pure function of this value.
public struct SignalHistoryResolved: Sendable, Equatable {
    /// The mutually-exclusive render branches.
    public enum Phase: Sendable, Equatable {
        case loading
        case data
        case empty
        case error(String)
    }

    public let phase: Phase
    public let rows: [SignalHistoryRow]
    public let page: Int
    public let pageSize: Int
    public let totalRows: Int
    public let pageCount: Int
    public let title: String?
    public let showHeaderMeta: Bool
    public let expandable: Bool

    public init(
        phase: Phase,
        rows: [SignalHistoryRow],
        page: Int,
        pageSize: Int,
        totalRows: Int,
        pageCount: Int,
        title: String?,
        showHeaderMeta: Bool,
        expandable: Bool
    ) {
        self.phase = phase
        self.rows = rows
        self.page = page
        self.pageSize = pageSize
        self.totalRows = totalRows
        self.pageCount = pageCount
        self.title = title
        self.showHeaderMeta = showHeaderMeta
        self.expandable = expandable
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web `loading ? skeleton : (rows.length ? table : empty)` ladder, with the
/// native error branch slotted after loading (loading mirrors the web, which shows the
/// skeleton whenever `loading` is true regardless of any concurrent parent error).
/// Unit-tested across every branch.
public enum SignalHistoryProjection {
    public static func resolve(_ input: SignalHistoryInput) -> SignalHistoryResolved {
        let pageCount = SignalHistoryFormat.pageCount(total: input.totalRows, pageSize: input.pageSize)
        func make(_ phase: SignalHistoryResolved.Phase, _ rows: [SignalHistoryRow]) -> SignalHistoryResolved {
            SignalHistoryResolved(
                phase: phase,
                rows: rows,
                page: input.page,
                pageSize: input.pageSize,
                totalRows: input.totalRows,
                pageCount: pageCount,
                title: input.title,
                showHeaderMeta: input.showHeaderMeta,
                expandable: input.expandable
            )
        }
        if input.isLoading {
            return make(.loading, [])
        }
        if let message = input.errorMessage, !message.isEmpty {
            return make(.error(message), [])
        }
        let rows = SignalHistoryAdapter.rows(from: input.rows, selectedSignals: input.selectedSignals)
        return make(rows.isEmpty ? .empty : .data, rows)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent
/// signal-history query (the SignalLogViewer/Explorer/Workspace pages); previews + tests
/// use `InMemorySignalHistorySource`. The view never talks to the network directly.
@MainActor
public protocol SignalHistorySource: AnyObject {
    var onUpdate: (@MainActor (SignalHistoryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// The native mirror of the web `onPageChange(page)` prop (1-based). The production
    /// source forwards this to the parent query's page state, which re-pushes a snapshot.
    func requestPage(_ page: Int)
}

/// The table's observable view-model. Subscribes to a `SignalHistorySource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, forwards page requests, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class SignalHistoryModel {
    public private(set) var resolved: SignalHistoryResolved
    public private(set) var connection: SignalHistoryConnection = .live

    public var phase: SignalHistoryResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any SignalHistorySource
    @ObservationIgnored private let telemetry: any SignalHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SignalHistorySource,
        telemetry: any SignalHistoryTelemetry = OSLogSignalHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = SignalHistoryProjection.resolve(SignalHistoryInput(isLoading: true))
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalHistoryDiagnostics.surface)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the current page (header refresh button + error-state retry).
    public func refresh() {
        source.refresh()
    }

    /// Requests a new 1-based page (web `onPageChange`). Clamped to `[1, pageCount]` so
    /// the Pagination control can never ask the parent for an out-of-range page.
    public func goToPage(_ page: Int) {
        let clamped = min(max(page, 1), max(resolved.pageCount, 1))
        source.requestPage(clamped)
    }

    private func apply(_ input: SignalHistoryInput) {
        resolved = SignalHistoryProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`; it records
/// the lifecycle + page-request calls so the view-model wiring can be asserted.
@MainActor
public final class InMemorySignalHistorySource: SignalHistorySource {
    public var onUpdate: (@MainActor (SignalHistoryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var requestedPages: [Int] = []

    private let initial: SignalHistoryInput?

    public init(initial: SignalHistoryInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func requestPage(_ page: Int) {
        requestedPages.append(page)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: SignalHistoryInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "SignalHistoryTable" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time so each parallel surface owns its
/// own strings without editing the shared catalog.
public enum SHStrings {
    public static let table = "SignalHistoryTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
