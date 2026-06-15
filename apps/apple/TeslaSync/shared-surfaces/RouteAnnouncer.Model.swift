//
//  RouteAnnouncer.Model.swift
//  TeslaSync — P4 shared surface · 0002 · RouteAnnouncer (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the deferred-read scheduler
//  seam, the i18n facade (P1/S10), and the pure projection for the route-change announcer. The
//  view binds through `RouteAnnouncerModel`; no networking, no timers, and no assistive-tech
//  posting live in the view. The web source subscribes to the router location and, on every
//  pathname change after the first render, defers a read of `document.title` into a polite live
//  region. The native model keeps the same data contract: a source emits the current route
//  snapshot plus the parent's loading / error / connectivity state, the model arms a deferred
//  read on each route change (cancelling any pending one), builds the rotating padded
//  announcement, posts it to the assistive technology through the presenter seam, and derives
//  the view-ready projection.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying
/// constant.
public protocol RouteAnnouncerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogRouteAnnouncerTelemetry: RouteAnnouncerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement presenter seam (native parity of the web aria-live voicing)

/// Posts a route-change announcement to the assistive technology — the native boundary that
/// replaces the web polite `aria-live` region's automatic voicing. The view injects
/// `AccessibilityRouteAnnouncementPresenter` (which posts an `AccessibilityNotification`); tests
/// inject a recording double; the model default logs so previews never emit live speech.
@MainActor
public protocol RouteAnnouncementPresenter {
    func announce(_ announcement: RouteAnnouncement)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology,
/// so previews and headless models run quietly.
@MainActor
public struct OSLogRouteAnnouncementPresenter: RouteAnnouncementPresenter {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ announcement: RouteAnnouncement) {
        logger.info("route.announce sequence=\(announcement.id, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound route feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum RouteAnnouncerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (current route + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the current route (the native mirror of the
/// web `useLocation()` value, carrying the resolved page title) plus the parent's lifecycle
/// (`isLoading`, an error message, and connectivity). A `nil` snapshot is the pre-navigation
/// state (web initial mount before a route resolves).
public struct RouteAnnouncerInput: Sendable, Equatable {
    public var snapshot: RouteSnapshot?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: RouteAnnouncerConnection

    public init(
        snapshot: RouteSnapshot? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: RouteAnnouncerConnection = .live
    ) {
        self.snapshot = snapshot
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data phase the live
/// region's current announcement plus the recent navigation history (most-recent-first) are
/// pre-computed so the view is a pure function of this value.
public struct RouteAnnouncerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let current: RouteAnnouncement?
    public let history: [RouteAnnouncement]

    public init(phase: Phase, current: RouteAnnouncement?, history: [RouteAnnouncement]) {
        self.phase = phase
        self.current = current
        self.history = history
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the accumulated announcer state to the resolved view-state — the native
/// port of the announcer's read-time region content plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data. The `current` announcement and `history` are the
/// values the model has built from route changes; the projection only selects the phase and
/// passes them through.
public enum RouteAnnouncerProjection {
    public static func resolve(
        isLoading: Bool,
        errorMessage: String?,
        current: RouteAnnouncement?,
        history: [RouteAnnouncement]
    ) -> RouteAnnouncerResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = errorMessage, !message.isEmpty {
            return RouteAnnouncerResolved(phase: .error(message), current: nil, history: [])
        }
        // Initial fetch (web parent `isLoading`).
        if isLoading {
            return RouteAnnouncerResolved(phase: .loading, current: nil, history: [])
        }
        // Resolved with nothing announced yet → friendly empty state (never blank), the web
        // region that starts empty and is silent on first paint.
        guard !history.isEmpty else {
            return RouteAnnouncerResolved(phase: .empty, current: nil, history: [])
        }
        return RouteAnnouncerResolved(phase: .data, current: current, history: history)
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `RouteAnnouncerSource`, and on every
/// route change after the first arms a deferred title read through the scheduler seam
/// (cancelling any pending read so a rapid second navigation announces only its destination —
/// web effect-cleanup parity). When the read fires it builds the rotating padded announcement
/// (or clears the region when the title is empty), posts it to the assistive technology through
/// the presenter, recomputes the resolved projection, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class RouteAnnouncerModel {
    /// Default deferred-read delay — the web `DEFAULT_ANNOUNCE_DELAY_MS` (100 ms) expressed in
    /// seconds, so the new page's title settles before it is read.
    public static let defaultDelaySeconds: Double = 0.1

    public private(set) var resolved: RouteAnnouncerResolved =
        .init(phase: .empty, current: nil, history: [])
    public private(set) var connection: RouteAnnouncerConnection = .live

    public var phase: RouteAnnouncerResolved.Phase {
        resolved.phase
    }

    /// The deferred-read delay (web `delayMs` prop), kept overridable so tests can drive the
    /// timer deterministically.
    public let delaySeconds: Double

    @ObservationIgnored private let source: any RouteAnnouncerSource
    @ObservationIgnored private let telemetry: any RouteAnnouncerTelemetry
    @ObservationIgnored private let presenter: any RouteAnnouncementPresenter
    @ObservationIgnored private let scheduler: any RouteAnnouncerScheduler
    @ObservationIgnored private let clock: @MainActor () -> Date
    @ObservationIgnored private let historyLimit: Int

    @ObservationIgnored private var started = false
    @ObservationIgnored private var sawFirstRoute = false
    @ObservationIgnored private var currentPath: String?
    @ObservationIgnored private var announceCounter = 0
    @ObservationIgnored private var latestSnapshot: RouteSnapshot?
    @ObservationIgnored private var pendingRead: RouteAnnouncerCancellable?
    @ObservationIgnored private var current: RouteAnnouncement?
    @ObservationIgnored private var history: [RouteAnnouncement] = []
    @ObservationIgnored private var isLoading = false
    @ObservationIgnored private var errorMessage: String?

    public init(
        source: any RouteAnnouncerSource,
        telemetry: any RouteAnnouncerTelemetry = OSLogRouteAnnouncerTelemetry(),
        presenter: any RouteAnnouncementPresenter = OSLogRouteAnnouncementPresenter(),
        scheduler: any RouteAnnouncerScheduler = TaskRouteAnnouncerScheduler(),
        delaySeconds: Double = RouteAnnouncerModel.defaultDelaySeconds,
        historyLimit: Int = 20,
        clock: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.presenter = presenter
        self.scheduler = scheduler
        self.delaySeconds = delaySeconds
        self.historyLimit = historyLimit
        self.clock = clock
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RouteAnnouncer.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed and cancels any pending deferred read.
    public func stop() {
        started = false
        pendingRead?.cancel()
        pendingRead = nil
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: RouteAnnouncerInput) {
        latestSnapshot = input.snapshot
        isLoading = input.isLoading
        errorMessage = input.errorMessage
        let previous = connection
        connection = input.connection

        if let snapshot = input.snapshot, snapshot.path != currentPath {
            currentPath = snapshot.path
            armRead()
        }

        recompute()

        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Arms the deferred title read for the latest route change — the web effect scheduling a
    /// `setTimeout(delayMs)`. The first route seen is the landing page, which the browser already
    /// voices, so it is skipped (web first-render guard). A pending read is cancelled first so a
    /// rapid second navigation announces only its final destination (web effect cleanup).
    private func armRead() {
        guard sawFirstRoute else {
            sawFirstRoute = true
            return
        }
        pendingRead?.cancel()
        pendingRead = scheduler.schedule(after: delaySeconds) { [weak self] in
            self?.fireRead()
        }
    }

    /// The deferred read — the web `setTimeout` body. Reads the freshest resolved title, clears
    /// the region when it is empty, or builds + posts the rotating padded announcement.
    private func fireRead() {
        pendingRead = nil
        let title = latestSnapshot?.title ?? ""
        guard let announcement = RouteAnnouncerLogic.announcement(
            path: latestSnapshot?.path ?? "",
            title: title,
            sequence: announceCounter + 1,
            at: clock()
        ) else {
            // Empty title — clear the region without voicing and without advancing the counter
            // (web `setMessage('')`).
            current = nil
            recompute()
            return
        }
        announceCounter += 1
        current = announcement
        history.insert(announcement, at: 0)
        if history.count > historyLimit {
            history.removeLast(history.count - historyLimit)
        }
        presenter.announce(announcement)
        recompute()
    }

    private func recompute() {
        resolved = RouteAnnouncerProjection.resolve(
            isLoading: isLoading,
            errorMessage: errorMessage,
            current: current,
            history: history
        )
    }
}
