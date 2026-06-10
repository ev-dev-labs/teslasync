//
//  SessionExpiredModal.Model.swift
//  TeslaSync — P4 modal/dialog · 0008 · SessionExpiredModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SessionExpiredModal` reads
//  `useSessionMonitor()` for `{ mode, hasExpired }`, latches a `teslasync:session-expired` document
//  event in local state (`eventTriggered`, sticky once fired), suppresses itself in open mode, and
//  computes `open = hasExpired || eventTriggered`; the only action hands off to `navigateToReauth`.
//  The native surface reproduces that whole lifecycle here: a `SessionExpiredSource` pushes the
//  resolved session slice + freshness, and the model owns the latched event, the resolved
//  `SessionExpiredPhase`, the re-auth command seam, and the diagnostics emission. No network and no
//  navigation live in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `SessionExpiredSource`, latches the
/// `teslasync:session-expired` event, exposes the resolved render phase + live-state freshness,
/// drives the re-auth command seam (web `navigateToReauth`), and emits the P1/S11 `view.opened`
/// event once on first appearance.
@MainActor
@Observable
public final class SessionExpiredModel {
    public private(set) var phase: SessionExpiredPhase = .loading
    public private(set) var connection: SessionConnection = .live
    public private(set) var context: SessionContext?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SessionExpiredSource
    @ObservationIgnored private let telemetry: any SessionExpiredTelemetry
    @ObservationIgnored private let controller: any SessionReauthController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var eventLatched = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionExpiredSource,
        telemetry: any SessionExpiredTelemetry = OSLogSessionExpiredTelemetry(),
        controller: any SessionReauthController = OSLogSessionReauthController(),
        localize: @escaping (String, String) -> String = SessionExpiredStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived

    /// Whether the hard block is engaged (web `open` — the only time the overlay must be presented).
    /// A host uses this to decide whether to actually mount the overlay; the standalone surface
    /// renders an informative state for every other phase rather than a blank box.
    public var isBlocking: Bool {
        phase == .expired
    }

    /// Whether the surface is operating on a cached verdict with no connectivity (web has no analog;
    /// surfaced so the block can warn that re-auth needs a connection).
    public var isOffline: Bool {
        connection == .offline
    }

    /// The VoiceOver summary for the current phase.
    public var accessibilitySummary: String {
        SessionExpiredAccessibility.summary(for: phase, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SessionExpiredSurface.slug)
        source.start()
    }

    /// Stops observing the upstream session feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-polls `/auth/session` (web refetch) — the error-state retry + stale auto-refresh action.
    public func refresh() {
        source.refresh()
    }

    // MARK: Commands (web `navigateToReauth`)

    /// Hands off to the IdP re-auth entry point (web `handleSignIn` → `navigateToReauth`). Faithful
    /// to the web, the action is always available; offline is surfaced as an inline note rather than
    /// disabling the only escape hatch.
    public func signIn() {
        controller.signIn()
    }

    // MARK: Snapshot application

    private func apply(_ update: SessionExpiredUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        if update.context?.eventTriggered == true { eventLatched = true }
        let resolved = update.context?.latchingEvent(eventLatched)
        context = resolved
        phase = SessionExpiredProjection.resolvePhase(status: update.status, context: resolved)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached verdict on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: SessionConnection) {
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
