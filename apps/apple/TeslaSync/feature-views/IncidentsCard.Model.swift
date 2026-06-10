//
//  IncidentsCard.Model.swift
//  TeslaSync — P4 feature view · 0247 · IncidentsCard (Apple)
//
//  The state holder (P1/S8) the view binds through, the telemetry seam (P1/S11 `view.opened`),
//  the i18n facade (P1/S10), and the in-memory sources for previews/tests — the SwiftUI parity
//  of features/system/components/status/IncidentsCard.tsx.
//
//  The web component reads `useIncidents({ activeOnly: true })` (GET /status/incidents?active=1)
//  and owns the local `open` state that mounts the `IncidentForm` dialog (its only mutation
//  path). The native surface reproduces that whole lifecycle here: an `IncidentsSource` pushes
//  the resolved rows + load status + live-state freshness, and the model owns the resolved
//  `IncidentsCardPhase`, the one-shot stale auto-refresh, and the "Log incident" sheet state +
//  the post-dismiss list refresh (the native form invalidates the incidents list, so the card
//  refetches on close). No networking lives in the view.
//
//  SwiftUI-free (Foundation / Observation / OSLog) so the model + adapter logic compile and run
//  on a plain host; the SwiftUI chrome lives in `IncidentsCard.swift`. The `IncidentCreating`
//  seam the "Log incident" form binds through is REUSED from the sibling `IncidentForm`
//  (surface 0246, same module) — not redefined.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the surface's
/// appearance through this protocol so production wiring, previews, and tests can each supply
/// their own sink.
public protocol IncidentsCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is a static,
/// non-identifying constant logged verbatim; no incident content is recorded.
public struct OSLogIncidentsCardTelemetry: IncidentsCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "IncidentsCard" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; they are kept in a per-surface table so
/// each parallel surface prompt owns its own strings without editing the shared catalog
/// (parallel-unsafe across the concurrent slots).
public enum IncidentsCardStrings {
    public static let table = "IncidentsCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `LocalizedText` descriptor (web `t(key, fallback)`).
    public static func string(_ text: LocalizedText) -> String {
        string(text.key, text.fallback)
    }
}

// MARK: - Read-source seam (P1/S8 — web `useIncidents({ activeOnly: true })`)

/// One snapshot the source pushes into the model: the resolved active-incident rows, the load
/// status, the live-state freshness, and the last-updated instant. Equatable so the model can
/// short-circuit redundant applies.
public struct IncidentsUpdate: Sendable, Equatable {
    public let status: IncidentsLoadStatus
    public let connection: IncidentsConnection
    public let incidents: [ActiveIncident]
    public let updatedAt: Date?

    public init(
        status: IncidentsLoadStatus,
        connection: IncidentsConnection = .live,
        incidents: [ActiveIncident],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.incidents = incidents
        self.updatedAt = updatedAt
    }
}

/// The seam the model subscribes to for the active-incidents list. Production implements this
/// over the shared P1/S8 incidents state holder + live feed; previews/tests use
/// `InMemoryIncidentsSource` / `ControllableIncidentsSource`. The view never talks to the
/// network directly.
@MainActor
public protocol IncidentsSource: AnyObject {
    /// Invoked on the main actor whenever a new snapshot is available.
    var onUpdate: ((IncidentsUpdate) -> Void)? { get set }

    /// Begins observing the active-incidents feed (web query mount).
    func start()

    /// Stops observing (web query unmount).
    func stop()

    /// Re-runs the underlying query (web refetch) — the error-state retry + the stale
    /// auto-refresh + the post-log-form refresh.
    func refresh()
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to an `IncidentsSource`, holds the latest
/// rows + freshness, exposes the resolved render phase + the "Log incident" sheet state, drives
/// the one-shot stale auto-refresh, and emits the P1/S11 `view.opened` event once on first
/// appearance. No networking lives in the view.
@MainActor
@Observable
public final class IncidentsCardModel {
    // Load + freshness (from the source)
    public private(set) var phase: IncidentsCardPhase = .loading
    public private(set) var connection: IncidentsConnection = .live
    public private(set) var incidents: [ActiveIncident] = []
    public private(set) var updatedAt: Date?

    /// The list-query failure message kept while cached rows remain on screen, so the content
    /// branch can surface an inline error above the retained list instead of blanking it.
    public private(set) var loadFailure: String?

    /// Whether the "Log incident" sheet is presented (web local `open` state). Bindable so the
    /// SwiftUI `.sheet(isPresented:)` can drive it; mutate via `presentLogForm()` from the CTA.
    public var isPresentingLogForm = false

    /// The create seam the presented `IncidentForm` binds through (web `useCreateIncident`),
    /// supplied by the host alongside the read source.
    public let incidentCreator: any IncidentCreating

    @ObservationIgnored private let source: any IncidentsSource
    @ObservationIgnored private let telemetry: any IncidentsCardTelemetry
    @ObservationIgnored let localize: (LocalizedText) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any IncidentsSource,
        incidentCreator: any IncidentCreating,
        telemetry: any IncidentsCardTelemetry = OSLogIncidentsCardTelemetry(),
        localize: @escaping (LocalizedText) -> String = IncidentsCardStrings.string
    ) {
        self.source = source
        self.incidentCreator = incidentCreator
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived projections

    /// The active-incident count shown in the header badge (web `incidents.length`).
    public var count: Int {
        incidents.count
    }

    /// The inline list-error message shown above the populated rows (a reload failed while
    /// cached rows remain), present only when rows are on screen.
    public var inlineErrorMessage: String? {
        guard case .content = phase else { return nil }
        return loadFailure
    }

    /// The card's VoiceOver summary (web header + count badge).
    public var accessibilityLabel: String {
        IncidentsCardAccessibility.cardLabel(count: count, localize: localize)
    }

    /// One row's VoiceOver summary, composed against the supplied display clock.
    public func rowAccessibilityLabel(_ incident: ActiveIncident, now: Date) -> String {
        IncidentsCardAccessibility.rowLabel(incident, now: now, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        IncidentsCardSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream incidents feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Log-incident sheet (web `open` state mounting `<IncidentForm>`)

    /// Opens the "Log incident" sheet (web `setOpen(true)`).
    public func presentLogForm() {
        isPresentingLogForm = true
    }

    /// The dismiss handler the presented form's `onClose` raises (web `setOpen(false)`).
    public func dismissLogForm() {
        isPresentingLogForm = false
    }

    /// Reacts to the sheet finishing its dismissal: refetches the list so a just-logged
    /// incident appears (web `useCreateIncident` invalidates the incidents query on success).
    public func handleLogFormDismissed() {
        source.refresh()
    }

    // MARK: Snapshot application

    private func apply(_ update: IncidentsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        incidents = update.incidents
        loadFailure = Self.failureMessage(update.status)
        phase = IncidentsCardAdapter.resolvePhase(status: update.status, incidentCount: incidents.count)
        handleAutoRefresh(for: update.connection)
    }

    /// The failure message carried by a failed status, else `nil`.
    private static func failureMessage(_ status: IncidentsLoadStatus) -> String? {
        if case let .failed(message) = status { return message }
        return nil
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once. Offline keeps the cached rows on
    /// screen and does not refetch.
    private func handleAutoRefresh(for connection: IncidentsConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory sources (previews + tests; the view never performs I/O)

/// Deterministic source for previews + unit tests. Pushes a canned `IncidentsUpdate` on
/// `start()` and again on every `refresh()`, recording the call counts so the lifecycle +
/// auto-refresh can be asserted.
@MainActor
public final class InMemoryIncidentsSource: IncidentsSource {
    public var onUpdate: ((IncidentsUpdate) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let update: IncidentsUpdate

    public init(update: IncidentsUpdate) {
        self.update = update
    }

    public func start() {
        startCount += 1
        onUpdate?(update)
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        onUpdate?(update)
    }
}

/// Source whose emissions are driven by the test, so the loading → loaded / failure / stale /
/// offline transitions can be asserted deterministically. Records the refresh calls so the
/// auto-refresh + retry + post-log-form refresh can be verified.
@MainActor
public final class ControllableIncidentsSource: IncidentsSource {
    public var onUpdate: ((IncidentsUpdate) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    public init() {}

    public func start() {
        startCount += 1
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model.
    public func emit(_ update: IncidentsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Preview/UI-snapshot seams (DEBUG only)

#if DEBUG
    public extension IncidentsCardModel {
        /// Seeds a snapshot directly for previews / UI snapshots — no I/O.
        func previewApply(_ update: IncidentsUpdate) {
            apply(update)
        }
    }
#endif
