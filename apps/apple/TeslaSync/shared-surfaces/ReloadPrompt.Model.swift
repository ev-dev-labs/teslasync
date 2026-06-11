//
//  ReloadPrompt.Model.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the new-version reload prompt. The view binds through `ReloadPromptModel`; no
//  networking lives in the view. The web data owner is `useRegisterSW` (vite-plugin-pwa), which exposes
//  `needRefresh` + `updateServiceWorker(reload)` and re-checks every five minutes; the native model
//  keeps the same contract: a source emits coalesced snapshots of the registration's update / load /
//  connectivity status, the model recomputes the resolved render phase, drives the one-second countdown
//  (web `setCountdown` interval), forwards the "Later" / "Reload Now" intents, and auto-refreshes once
//  when the registration goes stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol ReloadPromptTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogReloadPromptTelemetry: ReloadPromptTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound registration feed — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum ReloadPromptConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Load status (web `useRegisterSW` registration lifecycle)

/// The update-check lifecycle for the registration, mirroring the states the production source projects
/// from the service-worker registration: the first check in flight, an idle/settled check, or a failed
/// registration (web `onRegisterError`).
public enum ReloadPromptStatus: Sendable, Equatable {
    case checking
    case idle
    case failed(String)
}

// MARK: - Input snapshot (coalesced source push)

/// One coalesced snapshot of the surface's inputs — the registration's update flag (the web
/// `needRefresh`) plus its load / connectivity lifecycle. The model derives the resolved render phase
/// over it, resets the countdown when the update first appears, and tracks the `connection` axis for the
/// freshness chip.
public struct ReloadPromptUpdate: Sendable, Equatable {
    public var status: ReloadPromptStatus
    public var connection: ReloadPromptConnection
    public var isChecking: Bool
    /// Web `needRefresh` — a newer build has been fetched and is waiting to activate.
    public var updateAvailable: Bool
    public var checkedAt: Date?

    public init(
        status: ReloadPromptStatus = .checking,
        connection: ReloadPromptConnection = .live,
        isChecking: Bool = false,
        updateAvailable: Bool = false,
        checkedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isChecking = isChecking
        self.updateAvailable = updateAvailable
        self.checkedAt = checkedAt
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body. A pure value so the view is a function of
/// it and snapshot tests assert it directly.
public struct ReloadPromptResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the coalesced snapshot to the resolved view-state — the native port of the web
/// surface's control flow plus the P4 leaf contract. The web renders the banner only while
/// `needRefresh` is true and `null` otherwise; the native leaf never collapses to a blank box, so a
/// settled check with no update is the friendly `empty` ("up to date") and a failed registration with no
/// update is a retryable `error`. A pending update always wins and renders the `data` banner regardless
/// of the check status (a transient re-check failure must not hide a build that is ready). Unit tested
/// across every branch.
public enum ReloadPromptProjection {
    public static func resolve(
        status: ReloadPromptStatus,
        updateAvailable: Bool,
        connection _: ReloadPromptConnection
    ) -> ReloadPromptResolved {
        if updateAvailable {
            return ReloadPromptResolved(phase: .data)
        }
        switch status {
        case .checking:
            return ReloadPromptResolved(phase: .loading)
        case .idle:
            return ReloadPromptResolved(phase: .empty)
        case let .failed(message):
            return ReloadPromptResolved(phase: .error(message))
        }
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `ReloadPromptSource`, recomputes the resolved
/// render `phase`, exposes the `connection` axis, drives the one-second auto-reload countdown (web
/// `setCountdown` interval), forwards the "Later" (web `dismiss`) and "Reload Now" (web
/// `updateServiceWorker(true)`) intents, and auto-refreshes once when the registration transitions to
/// stale.
@MainActor
@Observable
public final class ReloadPromptModel {
    public private(set) var resolved = ReloadPromptResolved(phase: .loading)
    public private(set) var connection: ReloadPromptConnection = .live
    public private(set) var isChecking = false
    public private(set) var checkedAt: Date?
    /// The live countdown shown in the banner — web `countdown`, reset to `COUNTDOWN_SECONDS` each time
    /// the update first appears and decremented once per second by `tick()`.
    public private(set) var countdown = ReloadPromptConstants.countdownSeconds

    public var phase: ReloadPromptResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any ReloadPromptSource
    @ObservationIgnored private let telemetry: any ReloadPromptTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastConnection: ReloadPromptConnection = .live
    @ObservationIgnored private var didReload = false

    public init(
        source: any ReloadPromptSource,
        telemetry: any ReloadPromptTelemetry = OSLogReloadPromptTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ReloadPrompt.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream registration.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests an update check (freshness chip + error retry) — the web `registration.update()`.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the registration has gone stale but is not already checking — the native
    /// parity of the web freshness self-refresh on stale queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isChecking else { return }
        source.refresh()
    }

    /// Advances the countdown by one second — the port of the web interval callback. On reaching the
    /// threshold it activates the new build exactly once (web `updateServiceWorker(true)`); a positive
    /// value simply updates the displayed second. A no-op once the build has been activated or when the
    /// banner is not showing, so a stray tick never double-reloads.
    public func tick() {
        guard phase == .data, !didReload else { return }
        switch ReloadCountdown.next(from: countdown) {
        case .reload:
            countdown = 0
            performReload()
        case let .tick(next):
            countdown = next
        }
    }

    /// The "Reload Now" intent (web `doReload`): cancels the countdown and activates the new build
    /// immediately. Idempotent against a countdown that already elapsed.
    public func reloadNow() {
        guard !didReload else { return }
        countdown = 0
        performReload()
    }

    /// The "Later" intent (web `dismiss`): cancels the countdown and hides the banner. Resolves locally
    /// to the settled `empty` state so a re-render does not re-show the dismissed banner, then notifies
    /// the source so the registration clears its `needRefresh` flag.
    public func dismiss() {
        resolved = ReloadPromptProjection.resolve(status: .idle, updateAvailable: false, connection: connection)
        countdown = ReloadPromptConstants.countdownSeconds
        source.dismiss()
    }

    private func performReload() {
        didReload = true
        source.applyUpdate()
    }

    private func apply(_ update: ReloadPromptUpdate) {
        isChecking = update.isChecking
        checkedAt = update.checkedAt
        let wasData = resolved.phase == .data
        resolved = ReloadPromptProjection.resolve(
            status: update.status,
            updateAvailable: update.updateAvailable,
            connection: update.connection
        )
        // Reset the countdown when the update banner first appears (web effect: `setCountdown(3)` when
        // `needRefresh` flips true), so each fresh prompt counts down from the start.
        if resolved.phase == .data, !wasData {
            countdown = ReloadPromptConstants.countdownSeconds
            didReload = false
        }
        let previous = lastConnection
        connection = update.connection
        lastConnection = update.connection
        if update.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "ReloadPrompt" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum ReloadPromptStrings {
    public static let table = "ReloadPrompt"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
