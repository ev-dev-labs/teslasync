//
//  SessionExpiringModal.Model.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The state holder (P1/S8) the view binds through. The web `SessionExpiringModal` binds
//  `useSessionMonitor` (a 5-min `/auth/session` poll that tightens near expiry, plus a 1Hz local
//  clock tick so the countdown animates), reads the unsaved-draft registry on each open, and owns
//  the "Stay signed in" in-flight state. The native surface reproduces that whole lifecycle here:
//  a `SessionExpiringSource` pushes the resolved session snapshot + drafts + load / freshness
//  status, the model derives the session state against an injected clock (re-derived every `tick`),
//  resolves the visibility + body phase, owns the stay/sign-out command seam, and emits the P1/S11
//  `view.opened` event once on first appearance. No networking lives in the view.
//

import Foundation
import Observation

/// The surface's observable view-model. Subscribes to a `SessionExpiringSource`, holds the latest
/// session snapshot + draft inventory + freshness, derives the session state + resolved visibility
/// + body phase against an injected clock, exposes the countdown + draft display copy, and drives
/// the stay / sign-out seams.
@MainActor
@Observable
public final class SessionExpiringModel {
    // Source state (web `useSessionMonitor` + draft registry)
    public private(set) var loadStatus: SessionExpiringLoadStatus = .loading
    public private(set) var connection: SessionExpiringConnection = .live
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    public private(set) var snapshot: SessionSnapshot?
    public private(set) var drafts: [SessionDraft] = []

    // Resolved render state
    public private(set) var derived: SessionDerivedState = .unknown
    public private(set) var visibility: SessionExpiringVisibility = .hidden
    public private(set) var phase: SessionExpiringPhase = .loading
    public private(set) var inlineErrorMessage: String?

    /// The "Stay signed in" in-flight state (web `refreshing` `useState`): drives the button label
    /// + disabled state while the renewal poll is awaited.
    public private(set) var staying = false

    /// Whether this is an intentionally-presented dialog (suppresses the ambient hide so loading /
    /// empty / error chrome still renders — engineering guideline #6).
    public let pinned: Bool

    /// The cap on listed drafts before the "+N more" overflow (web `drafts.slice(0, 5)`).
    public let maxDrafts: Int

    @ObservationIgnored private let source: any SessionExpiringSource
    @ObservationIgnored private let telemetry: any SessionExpiringTelemetry
    @ObservationIgnored private let controller: any SessionExpiringController
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionExpiringSource,
        pinned: Bool = false,
        maxDrafts: Int = SessionExpiringProjection.defaultDraftCap,
        telemetry: any SessionExpiringTelemetry = OSLogSessionExpiringTelemetry(),
        controller: any SessionExpiringController = OSLogSessionExpiringController(),
        localize: @escaping (String, String) -> String = SessionExpiringStrings.string,
        now: @escaping () -> Date = { Date() }
    ) {
        self.source = source
        self.pinned = pinned
        self.maxDrafts = maxDrafts
        self.telemetry = telemetry
        self.controller = controller
        self.localize = localize
        self.now = now
        recompute()
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    // MARK: Derived display

    /// The countdown body fragment (web `formatCountdown(expiresInSeconds ?? 0)`).
    public var countdownText: String {
        SessionCountdownFormatter.string(seconds: derived.expiresInSeconds ?? 0)
    }

    /// Whether any unsaved draft is present (web `drafts.length > 0`).
    public var hasDrafts: Bool {
        !drafts.isEmpty
    }

    /// The first `maxDrafts` drafts rendered as rows (web `drafts.slice(0, 5)`).
    public var visibleDrafts: [SessionDraft] {
        SessionExpiringProjection.visibleDrafts(drafts, cap: maxDrafts)
    }

    /// The "+N more" overflow count (web `drafts.length - 5`), zero within the cap.
    public var overflowDraftCount: Int {
        SessionExpiringProjection.overflowCount(drafts, cap: maxDrafts)
    }

    // MARK: Accessibility

    /// The dialog's region label (web `ariaLabel`).
    public var panelAccessibilityLabel: String {
        SessionExpiringAccessibility.summary(localize: localize)
    }

    /// The countdown line read as one VoiceOver phrase.
    public var countdownAccessibilityLabel: String {
        SessionExpiringAccessibility.countdownLabel(countdown: countdownText, localize: localize)
    }

    /// The unsaved-drafts region label (heading + total count).
    public var draftsAccessibilityLabel: String {
        SessionExpiringAccessibility.draftsLabel(count: drafts.count, localize: localize)
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SessionExpiringSurface.slug)
        source.start()
    }

    /// Stops observing the upstream session feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying poll (the error-state retry / stale refresh).
    public func refresh() {
        source.refresh()
    }

    /// Re-derives the session state against the live clock — the native parity of the web 1Hz
    /// tick, so the countdown animates and the modal hides itself once expiry passes.
    public func tick() {
        recompute()
    }

    // MARK: Commands (web `handleStay` / `handleSignOut` / `handleClose`)

    /// "Stay signed in" (web `handleStay`): flags the in-flight state, awaits the renewal poll, then
    /// pulls a fresh snapshot. Re-entrancy is guarded so a double-tap is a no-op.
    public func stay() async {
        guard !staying else { return }
        staying = true
        defer { staying = false }
        await controller.stay()
        source.refresh()
    }

    /// "Sign out now" (web `handleSignOut` → `navigateToReauth()`).
    public func signOut() {
        controller.signOut()
    }

    /// Esc / backdrop dismiss (web `handleClose` → `void handleStay()`): dismissing the soft-block
    /// warning implicitly runs the renewal poll rather than silently swallowing it.
    public func dismiss() {
        Task { await stay() }
    }

    // MARK: Snapshot application

    private func apply(_ update: SessionExpiringUpdate) {
        loadStatus = update.status
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        snapshot = update.session
        drafts = SessionExpiringProjection.sortedDrafts(update.drafts)
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    /// Re-derives the session state + resolved render state from the current snapshot, load status,
    /// and the live clock.
    private func recompute() {
        derived = SessionExpiringProjection.derive(snapshot, now: now())
        visibility = SessionExpiringProjection.resolveVisibility(derived: derived, pinned: pinned)
        let hasCountdown = derived.expiresInSeconds != nil
        phase = SessionExpiringProjection.resolvePhase(status: loadStatus, hasCountdown: hasCountdown)
        inlineErrorMessage = SessionExpiringProjection.inlineFailure(
            status: loadStatus,
            hasCountdown: hasCountdown
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached snapshot on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: SessionExpiringConnection) {
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
