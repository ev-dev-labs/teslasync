//
//  PullToRefresh.Model.swift
//  TeslaSync — P4 shared surface · 0188 · PullToRefresh (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  pull-to-refresh wrapper. The view binds through `PullToRefreshModel`; no networking lives in the
//  view (the web source has none — it reads three hooks and renders `children`). The model owns the
//  live gesture state (`pull`, `refreshing`), runs the same imperative state machine the web touch
//  handlers do (arm at scroll-top → resist the drag → fire `onRefresh` on a release past the
//  threshold), exposes the pure render geometry the view paints, and emits the `view.opened`
//  diagnostics event exactly once when the surface first appears.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink (consent
/// gated + redacted there). The slug is a static, non-identifying constant.
public protocol PullToRefreshTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPullToRefreshTelemetry: PullToRefreshTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "PullToRefresh" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum PullToRefreshStrings {
    public static let table = "PullToRefresh"

    public static let string: PullToRefreshResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Owns the live gesture state, runs the web touch state machine,
/// exposes the resolved render geometry + the localized indicator copy, and emits `view.opened` once on
/// first appear. There is no async data source because the web source has no data dependency; the only
/// async work is the host-supplied `onRefresh` the model awaits when a pull is released past the
/// threshold.
@MainActor
@Observable
public final class PullToRefreshModel {
    /// The live pull distance in points (web `pull`). Zero at rest.
    public private(set) var pull: Double = 0

    /// Whether the awaited `onRefresh` is in flight (web `refreshing`).
    public private(set) var refreshing = false

    /// The release threshold in points (web `threshold`), guarded positive.
    public let threshold: Double

    /// Whether the gesture is enabled (web `active = enabled ?? isCoarse`). When `false` the surface
    /// renders `children` straight through.
    public let active: Bool

    @ObservationIgnored private let onRefresh: @MainActor () async -> Void
    @ObservationIgnored private let telemetry: any PullToRefreshTelemetry
    @ObservationIgnored private let strings: PullToRefreshResolve
    @ObservationIgnored private var armed = false
    @ObservationIgnored private var isAtTop = true
    @ObservationIgnored private var started = false
    @ObservationIgnored private var refreshTask: Task<Void, Never>?

    public init(
        input: PullToRefreshInput = PullToRefreshInput(),
        onRefresh: @escaping @MainActor () async -> Void,
        telemetry: any PullToRefreshTelemetry = OSLogPullToRefreshTelemetry(),
        strings: @escaping PullToRefreshResolve = PullToRefreshStrings.string
    ) {
        threshold = input.effectiveThreshold
        active = input.isActive
        self.onRefresh = onRefresh
        self.telemetry = telemetry
        self.strings = strings
    }

    // MARK: Derived render geometry (pure projection)

    /// The resolved render phase (web JSX branch).
    public var phase: PullToRefreshPhase {
        PullToRefreshProjection.phase(pull: pull, threshold: threshold, refreshing: refreshing, active: active)
    }

    /// The pull progress 0…1 (web `progress`).
    public var progress: Double {
        PullToRefreshProjection.progress(pull: pull, threshold: threshold, refreshing: refreshing)
    }

    /// Whether a release now fires `onRefresh` (web `ready`).
    public var isReady: Bool {
        PullToRefreshProjection.isReady(pull: pull, threshold: threshold)
    }

    /// The indicator band height in points (web `indicatorHeight`).
    public var indicatorHeight: Double {
        PullToRefreshProjection.indicatorHeight(pull: pull, threshold: threshold, refreshing: refreshing)
    }

    /// The content's downward offset in points (web content `translate3d` Y).
    public var contentOffset: Double {
        PullToRefreshProjection.contentOffset(pull: pull, threshold: threshold, refreshing: refreshing)
    }

    /// The localized indicator label for the current phase (web `t(...)`).
    public var labelText: String {
        PullToRefreshAccessibility.statusLabel(for: phase, strings: strings)
    }

    /// The localized VoiceOver action name (native a11y affordance).
    public var actionLabel: String {
        PullToRefreshAccessibility.actionLabel(strings: strings)
    }

    /// The localized VoiceOver hint (native a11y affordance).
    public var hintLabel: String {
        PullToRefreshAccessibility.hintLabel(strings: strings)
    }

    // MARK: Gesture intents (web touch handlers)

    /// Records whether the scroll container is at its top — the gate the web reads via
    /// `isAtScrollTop(node)` before arming (`onTouchStart`).
    public func setAtTop(_ atTop: Bool) {
        isAtTop = atTop
    }

    /// Feeds a drag's downward translation into the state machine — the web `onTouchMove`. Arms on the
    /// first downward movement while at the scroll top; a movement back up (or while not armed off the
    /// top) collapses the pull and disarms, exactly as the web handler does.
    public func dragChanged(translationHeight: Double) {
        guard active, !refreshing else { return }
        if !armed {
            guard isAtTop, translationHeight > 0 else { return }
            armed = true
        }
        guard translationHeight > 0 else {
            if pull != 0 { pull = 0 }
            armed = false
            return
        }
        pull = PullToRefreshProjection.pull(forDelta: translationHeight, threshold: threshold)
    }

    /// Resolves a released drag — the web `release()`. Snaps back to rest and, when the release was
    /// armed and past the threshold, awaits `onRefresh` while showing the refreshing indicator.
    public func dragEnded() {
        guard active else { return }
        let wasArmed = armed
        let distance = pull
        armed = false
        pull = 0
        guard PullToRefreshProjection.shouldFire(pull: distance, threshold: threshold, armed: wasArmed),
              !refreshing
        else { return }
        beginRefresh()
    }

    /// Aborts an in-progress pull without firing — the web `onTouchCancel` → `reset()`.
    public func cancel() {
        armed = false
        if pull != 0 { pull = 0 }
    }

    /// Triggers a refresh directly (the native VoiceOver "Refresh" action / a programmatic refresh),
    /// bypassing the drag gesture. Idempotent while a refresh is already in flight.
    public func triggerRefresh() {
        guard active, !refreshing else { return }
        armed = false
        pull = 0
        beginRefresh()
    }

    // MARK: Lifecycle

    /// Records the surface open exactly once (P1/S11 `view.opened`). Idempotent across re-appears.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PullToRefreshMeta.surfaceSlug)
    }

    /// Cancels any in-flight refresh when the surface leaves the hierarchy.
    public func stop() {
        refreshTask?.cancel()
        refreshTask = nil
    }

    // MARK: - Private

    private func beginRefresh() {
        refreshing = true
        refreshTask?.cancel()
        refreshTask = Task { await self.runRefresh() }
    }

    private func runRefresh() async {
        await onRefresh()
        refreshing = false
        refreshTask = nil
    }
}
