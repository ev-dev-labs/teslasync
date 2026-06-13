//
//  MaintenanceBanner.Model.swift
//  TeslaSync — P4 shared surface · 0127 · MaintenanceBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the maintenance / degraded-mode banner. The view binds through
//  `MaintenanceBannerModel`; no networking lives in the view. The web `MaintenanceBanner` wraps
//  `useSystemHealth()`, hides itself when `mode === 'ok'` (or when the current snapshot is dismissed),
//  and otherwise renders a sticky banner with a 1 Hz live countdown to `maintenance_until`. The native
//  model keeps the same contract: a source emits the coalesced health snapshot (resolved mode +
//  maintenance message / until / updated-at + the query's load / connectivity state), the model derives
//  the resolved projection over it (including the per-snapshot dismissal and its reset on a fresh
//  snapshot), drives the countdown off an injected clock, and auto-refreshes once when the feed
//  transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity

/// The diagnostics surface slug, kept on a pure type so the model (and its isolated unit tests) need not
/// reference the SwiftUI surface view to emit `view.opened`.
public enum MaintenanceBannerSurface {
    public static let slug = "MaintenanceBanner"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol MaintenanceBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogMaintenanceBannerTelemetry: MaintenanceBannerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound health feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum MaintenanceBannerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (health state + feed lifecycle)

/// One coalesced snapshot of the surface's inputs — the web `useSystemHealth` result (`mode` +
/// `maintenance_message` / `maintenance_until` / `maintenance_updated_at`) plus the query's lifecycle
/// (`hasData` = the web `data != null`, an error message, and connectivity). `hasData == false` with no
/// error is the initial-load window (web `data` undefined); `hasData == true` with `mode == "ok"` is the
/// resolved no-banner state (web `return null`).
public struct MaintenanceBannerInput: Sendable, Equatable {
    /// Web `data?.mode` — the resolved backend service mode (`ok` / `degraded` / `maintenance`).
    public var mode: String
    /// Web `data?.maintenance_message` — the operator message folded into the body copy when non-blank.
    public var message: String
    /// Web `data?.maintenance_until` — the ISO-8601 window end driving the countdown.
    public var until: String
    /// Web `data?.maintenance_updated_at` — the operator update instant keying the dismissal.
    public var updatedAt: String
    /// Web `data != null` — a `/system/health` payload has resolved at least once.
    public var hasData: Bool
    /// The most recent feed error, surfaced only when no payload has resolved yet (web keeps last data).
    public var errorMessage: String?
    public var connection: MaintenanceBannerConnection

    public init(
        mode: String = "ok",
        message: String = "",
        until: String = "",
        updatedAt: String = "",
        hasData: Bool = false,
        errorMessage: String? = nil,
        connection: MaintenanceBannerConnection = .live
    ) {
        self.mode = mode
        self.message = message
        self.until = until
        self.updatedAt = updatedAt
        self.hasData = hasData
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// The resolved `MaintenanceBannerServiceMode` for the raw backend value (web `data?.mode ?? 'ok'`).
    public var serviceMode: MaintenanceBannerServiceMode {
        MaintenanceBannerServiceMode.forRaw(mode)
    }

    /// Web `!data || mode === 'ok'` inverted — a real banner-worthy snapshot has resolved.
    public var hasActiveBanner: Bool {
        hasData && serviceMode.isActive
    }

    /// The dismissal fingerprint for this snapshot (web `fingerprint(mode, message, until, updatedAt)`).
    public var fingerprint: String {
        MaintenanceBannerFingerprint.make(mode: mode, message: message, until: until, updatedAt: updatedAt)
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The data payload for the `.banner` phase — the fully-derived banner: the mode (for the tone / icon /
/// `data-mode` parity), the precomposed title + body, the dismissal fingerprint carried through so the
/// view's dismiss action knows what to persist, the parsed window-end millis driving the countdown, and
/// the SF Symbol name. A pure value so the view is a function of it and snapshot tests assert it directly.
public struct MaintenanceBannerData: Sendable, Equatable {
    public let mode: MaintenanceBannerServiceMode
    public let isMaintenance: Bool
    public let title: String
    public let body: String
    public let fingerprint: String
    public let untilMs: Double?
    public let systemImageName: String

    public init(
        mode: MaintenanceBannerServiceMode,
        isMaintenance: Bool,
        title: String,
        body: String,
        fingerprint: String,
        untilMs: Double?,
        systemImageName: String
    ) {
        self.mode = mode
        self.isMaintenance = isMaintenance
        self.title = title
        self.body = body
        self.fingerprint = fingerprint
        self.untilMs = untilMs
        self.systemImageName = systemImageName
    }
}

/// The resolved, view-ready state — `phase` selects the body; for the banner phase the derived `data`
/// payload is pre-computed so the view is a pure function of this value (plus the time-dependent
/// countdown text the model maintains separately off the clock).
public struct MaintenanceBannerResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case banner
    }

    public let phase: Phase
    public let data: MaintenanceBannerData?

    public init(phase: Phase, data: MaintenanceBannerData?) {
        self.phase = phase
        self.data = data
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot + the dismissed fingerprint to the resolved view-state — the
/// native port of the web banner's control flow plus the P4 leaf contract:
///   • no payload yet → `error` if the initial read failed, else `loading` (the web pre-resolve window).
///   • a resolved payload always governs: a background feed error is ignored while data is present (web
///     TanStack keeps the last `data`), so an active banner stays on screen through a transient failure.
///   • `mode === 'ok'` → the friendly `empty` (web `return null`) — the native improvement over rendering
///     nothing, never a blank box.
///   • a dismissed snapshot (the fingerprint matches the dismissed key) → `empty` (web `return null`).
///   • an active, non-dismissed snapshot → the `banner` with its pre-composed copy.
/// Unit tested across every branch.
public enum MaintenanceBannerProjection {
    public static func resolve(
        input: MaintenanceBannerInput,
        dismissedKey: String?,
        strings: MaintenanceBannerResolve = MaintenanceBannerStrings.string
    ) -> MaintenanceBannerResolved {
        guard input.hasData else {
            if let message = input.errorMessage, !message.isEmpty {
                return MaintenanceBannerResolved(phase: .error(message), data: nil)
            }
            return MaintenanceBannerResolved(phase: .loading, data: nil)
        }
        guard input.hasActiveBanner else {
            return MaintenanceBannerResolved(phase: .empty, data: nil)
        }
        if dismissedKey == input.fingerprint {
            return MaintenanceBannerResolved(phase: .empty, data: nil)
        }
        return MaintenanceBannerResolved(phase: .banner, data: payload(input, strings))
    }

    private static func payload(
        _ input: MaintenanceBannerInput,
        _ strings: MaintenanceBannerResolve
    ) -> MaintenanceBannerData {
        let mode = input.serviceMode
        let isMaintenance = mode.isMaintenance
        return MaintenanceBannerData(
            mode: mode,
            isMaintenance: isMaintenance,
            title: MaintenanceBannerMessage.title(isMaintenance: isMaintenance, strings: strings),
            body: MaintenanceBannerMessage.body(isMaintenance: isMaintenance, message: input.message, strings: strings),
            fingerprint: input.fingerprint,
            untilMs: MaintenanceBannerInstant.parseMs(input.until),
            systemImageName: mode.systemImageName
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `MaintenanceBannerSource`, recomputes the resolved
/// projection, exposes a render `phase` + the resolved view-state, the `connection` axis, and the live
/// `countdownText`. It mirrors the web component's lifecycle precisely: it resets a stale dismissal when
/// the upstream snapshot fingerprint changes (web `useEffect`), persists a dismissal per snapshot (web
/// `sessionStorage`), drives a 1 Hz countdown off the injected clock only while a banner with a window
/// end is showing (web `setInterval` gated on `mode !== 'ok' && untilMs !== null`), and auto-refreshes
/// once when the feed transitions to stale.
@MainActor
@Observable
public final class MaintenanceBannerModel {
    public private(set) var resolved = MaintenanceBannerResolved(phase: .loading, data: nil)
    public private(set) var connection: MaintenanceBannerConnection = .live
    public private(set) var countdownText: String?

    public var phase: MaintenanceBannerResolved.Phase {
        resolved.phase
    }

    public var data: MaintenanceBannerData? {
        resolved.data
    }

    @ObservationIgnored private let source: any MaintenanceBannerSource
    @ObservationIgnored private let telemetry: any MaintenanceBannerTelemetry
    @ObservationIgnored private let strings: MaintenanceBannerResolve
    @ObservationIgnored private let dismissalStore: any MaintenanceBannerDismissalStore
    @ObservationIgnored private let clock: any MaintenanceBannerClock
    @ObservationIgnored private var started = false
    @ObservationIgnored private var countdownRunning = false
    @ObservationIgnored private var dismissedKey: String?
    @ObservationIgnored private var lastInput = MaintenanceBannerInput()

    public init(
        source: any MaintenanceBannerSource,
        telemetry: any MaintenanceBannerTelemetry = OSLogMaintenanceBannerTelemetry(),
        strings: @escaping MaintenanceBannerResolve = MaintenanceBannerStrings.string,
        dismissalStore: any MaintenanceBannerDismissalStore = SessionMaintenanceBannerDismissalStore.shared,
        clock: any MaintenanceBannerClock = SystemMaintenanceBannerClock()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.strings = strings
        self.dismissalStore = dismissalStore
        self.clock = clock
        dismissedKey = dismissalStore.read()
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MaintenanceBannerSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed and tears down the countdown tick.
    public func stop() {
        started = false
        clock.stop()
        countdownRunning = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + post-window "refresh to confirm").
    public func refresh() {
        source.refresh()
    }

    /// Web dismiss button → persists the current snapshot's fingerprint and hides the banner. A later
    /// snapshot with a different fingerprint re-surfaces it (the dismissal reset in `apply`).
    public func dismiss() {
        guard resolved.phase == .banner, let fingerprint = resolved.data?.fingerprint else { return }
        dismissalStore.write(fingerprint)
        dismissedKey = fingerprint
        recompute(lastInput)
        updateCountdown()
    }

    private func apply(_ input: MaintenanceBannerInput) {
        lastInput = input
        if let key = dismissedKey, key != input.fingerprint {
            dismissedKey = nil
        }
        recompute(input)
        let previous = connection
        connection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
        updateCountdown()
    }

    private func recompute(_ input: MaintenanceBannerInput) {
        resolved = MaintenanceBannerProjection.resolve(input: input, dismissedKey: dismissedKey, strings: strings)
    }

    private func updateCountdown() {
        guard resolved.phase == .banner, let untilMs = resolved.data?.untilMs else {
            countdownText = nil
            if countdownRunning {
                clock.stop()
                countdownRunning = false
            }
            return
        }
        refreshCountdownText(untilMs: untilMs)
        if !countdownRunning {
            countdownRunning = true
            clock.start { [weak self] in self?.tick() }
        }
    }

    private func tick() {
        guard resolved.phase == .banner, let untilMs = resolved.data?.untilMs else {
            updateCountdown()
            return
        }
        refreshCountdownText(untilMs: untilMs)
    }

    private func refreshCountdownText(untilMs: Double) {
        let nowMs = clock.now().timeIntervalSince1970 * 1000
        countdownText = MaintenanceBannerMessage.countdown(remainingMs: untilMs - nowMs, strings: strings)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "MaintenanceBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum MaintenanceBannerStrings {
    public static let table = "MaintenanceBanner"

    public static let string: MaintenanceBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
