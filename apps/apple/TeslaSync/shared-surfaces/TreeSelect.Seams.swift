//
//  TreeSelect.Seams.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The dependency seams the TreeSelect view-model binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry seam, the polite-announcement seam (the native parity of the web
//  sr-only `aria-live` summary region), the P1/S8 source protocol, the production source that holds the
//  controlled snapshot and carries selection / search / expansion edits back to the host, and the
//  in-memory source for previews / tests.
//
//  Parity note: the web `TreeSelect` is a CONTROLLED primitive — the parent owns `selectedIds`,
//  `searchValue`, and the optional `expandedGroupIds`, passing fresh values on every render and receiving
//  `onChange` / `onSearchChange` / `onExpandedChange`. The native source reproduces that two-way contract:
//  the host pushes the current snapshot via `update(_:)`, and the field writes new selection / search /
//  expansion back via `commitSelection(_:)` / `commitSearch(_:)` / `commitExpanded(_:)`, which the live
//  source forwards to the host callbacks and re-emits (the parent re-render). The feed is local +
//  synchronous — no HTTP — so `start` / `refresh` simply re-emit the current snapshot.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter that forwards to the shared-core diagnostics sink (consent-gated +
/// redacted there). The slug is a static, non-identifying constant.
public protocol TreeSelectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogTreeSelectTelemetry: TreeSelectTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement seam (native parity of the web sr-only summary live region)

/// Posts a polite announcement to the assistive technology — the native boundary that replaces the web
/// component's hidden `aria-live="polite"` selection summary. The view injects ``LiveTreeSelectAnnouncer``
/// (which posts an `AccessibilityNotification.Announcement`); tests inject a recording double; the model
/// default logs so previews never emit live speech.
@MainActor
public protocol TreeSelectAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so previews
/// and headless models run quietly.
@MainActor
public struct OSLogTreeSelectAnnouncer: TreeSelectAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view binds through. The production app implements this over the host form's bound state
/// (`LiveTreeSelectSource`); previews and tests use the in-memory source. The view never reads or writes
/// the controlled state directly — it goes through the model and this seam.
@MainActor
public protocol TreeSelectSource: AnyObject {
    var onUpdate: (@MainActor (TreeSelectSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    /// Carries a new selection (the web `onChange(next)`) back to the host.
    func commitSelection(_ ids: [String])
    /// Carries a new search value (the web `onSearchChange(next)`) back to the host.
    func commitSearch(_ text: String)
    /// Carries a new expanded-group set (the web `onExpandedChange(next)`) back to the host.
    func commitExpanded(_ ids: [String])
}

// MARK: - Live source (production — holds the controlled snapshot, carries edits back)

/// The production source. Holds the host form's current snapshot and re-emits it whenever the host updates
/// it (`update(_:)`, the web parent passing new props) or the field commits a selection / search /
/// expansion edit. A committed value is stored, forwarded to the matching host callback, and re-emitted so
/// the surface reflects the new state — the native parity of the parent setting state and re-rendering.
@MainActor
public final class LiveTreeSelectSource: TreeSelectSource {
    public var onUpdate: (@MainActor (TreeSelectSnapshot) -> Void)?

    /// The host's selection handler — the web `onChange` callback.
    public var onChangeSelection: (@MainActor ([String]) -> Void)?
    /// The host's search handler — the web `onSearchChange` callback.
    public var onChangeSearch: (@MainActor (String) -> Void)?
    /// The host's expansion handler — the web `onExpandedChange` callback.
    public var onChangeExpanded: (@MainActor ([String]) -> Void)?

    private var current: TreeSelectSnapshot

    public init(
        value: TreeSelectSnapshot = TreeSelectSnapshot(),
        onChangeSelection: (@MainActor ([String]) -> Void)? = nil,
        onChangeSearch: (@MainActor (String) -> Void)? = nil,
        onChangeExpanded: (@MainActor ([String]) -> Void)? = nil
    ) {
        current = value
        self.onChangeSelection = onChangeSelection
        self.onChangeSearch = onChangeSearch
        self.onChangeExpanded = onChangeExpanded
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Sets the host's current snapshot and re-emits it — the native parity of the web parent passing fresh
    /// `groups` / `selectedIds` / `searchValue` / lifecycle on render.
    public func update(_ snapshot: TreeSelectSnapshot) {
        current = snapshot
        emit()
    }

    public func commitSelection(_ ids: [String]) {
        current.selectedIDs = ids
        onChangeSelection?(ids)
        emit()
    }

    public func commitSearch(_ text: String) {
        current.searchValue = text
        onChangeSearch?(text)
        emit()
    }

    public func commitExpanded(_ ids: [String]) {
        current.expandedGroupIDs = ids
        onChangeExpanded?(ids)
        emit()
    }

    private func emit() {
        onUpdate?(current)
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit / UI tests. Seeds an optional initial snapshot on `start()`,
/// records committed selection / search / expansion values + lifecycle call counts, and lets a test push
/// further snapshots.
@MainActor
public final class InMemoryTreeSelectSource: TreeSelectSource {
    public var onUpdate: (@MainActor (TreeSelectSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var committedSelections: [[String]] = []
    public private(set) var committedSearches: [String] = []
    public private(set) var committedExpansions: [[String]] = []

    private let initial: TreeSelectSnapshot?

    public init(initial: TreeSelectSnapshot? = nil) {
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

    public func commitSelection(_ ids: [String]) {
        committedSelections.append(ids)
    }

    public func commitSearch(_ text: String) {
        committedSearches.append(text)
    }

    public func commitExpanded(_ ids: [String]) {
        committedExpansions.append(ids)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ snapshot: TreeSelectSnapshot) {
        onUpdate?(snapshot)
    }
}
