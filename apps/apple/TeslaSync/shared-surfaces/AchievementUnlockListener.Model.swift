//
//  AchievementUnlockListener.Model.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  achievement-unlock listener. The view binds through `AchievementUnlockListenerModel`; no networking
//  lives in the view. A source emits the coalesced unlock-queue + prefs + connectivity snapshot, the
//  model recomputes the resolved projection, emits `view.opened` once on appear, plays the unlock
//  chime when the queue grows and the user opted into sound (the web WebAudio effect), drives each
//  visible toast's 6-second auto-dismiss through the injectable ticker (the web `setTimeout`), and
//  fires a one-shot refresh when the feed transitions to stale (the P4 leaf "stale → auto-refresh"
//  contract).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AchievementUnlockListenerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAchievementUnlockListenerTelemetry: AchievementUnlockListenerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `AchievementUnlockListenerSource`, recomputes
/// the resolved projection on every snapshot, exposes the render `phase` + resolved view-state + the
/// `connection` axis + the static `config`, emits the `view.opened` diagnostics event once on appear,
/// plays the unlock chime when a new unlock arrives while `playSound` is enabled (independent of the
/// toast opt-out, matching the web effect that runs before the `!showToasts` early return), drives the
/// per-toast auto-dismiss through the injected ticker, forwards the View deep-link to the host, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class AchievementUnlockListenerModel {
    public private(set) var resolved: AchievementUnlockListenerResolved

    public var phase: AchievementUnlockListenerResolved.Phase {
        resolved.phase
    }

    /// The visible celebration toasts (empty unless presenting the stack).
    public var toasts: [AchievementUnlockListenerToast] {
        resolved.toasts
    }

    /// Whether the snapshot is offline — surfaced so the view can decorate the cached toast stack.
    public var offline: Bool {
        resolved.offline
    }

    /// The freshness axis — drives the stale / offline freshness chip.
    public var connection: AchievementUnlockListenerConnection {
        resolved.connection
    }

    public let config: AchievementUnlockListenerConfig

    @ObservationIgnored private let source: any AchievementUnlockListenerSource
    @ObservationIgnored private let ticker: any AchievementUnlockListenerTicker
    @ObservationIgnored private let chime: any AchievementUnlockListenerChime
    @ObservationIgnored private let telemetry: any AchievementUnlockListenerTelemetry
    @ObservationIgnored private let strings: AchievementUnlockListenerResolve
    @ObservationIgnored private let onView: (@MainActor (String) -> Void)?
    @ObservationIgnored private var input = AchievementUnlockListenerInput()
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var lastEventCount = 0
    @ObservationIgnored private var lastConnection: AchievementUnlockListenerConnection = .live
    @ObservationIgnored private var remaining: [String: Int] = [:]
    @ObservationIgnored private var tickerArmed = false

    public init(
        source: any AchievementUnlockListenerSource,
        config: AchievementUnlockListenerConfig = .default,
        ticker: any AchievementUnlockListenerTicker = TimerAchievementUnlockListenerTicker(),
        chime: any AchievementUnlockListenerChime = SilentAchievementUnlockListenerChime(),
        telemetry: any AchievementUnlockListenerTelemetry = OSLogAchievementUnlockListenerTelemetry(),
        onView: (@MainActor (String) -> Void)? = nil,
        strings: @escaping AchievementUnlockListenerResolve = AchievementUnlockListenerStrings.string
    ) {
        self.source = source
        self.config = config
        self.ticker = ticker
        self.chime = chime
        self.telemetry = telemetry
        self.onView = onView
        self.strings = strings
        resolved = AchievementUnlockListenerProjection.resolve(
            AchievementUnlockListenerInput(),
            config: config,
            strings: strings
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the feed and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AchievementUnlockListenerMeta.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing the feed and halts the auto-dismiss clock.
    public func stop() {
        started = false
        ticker.stop()
        tickerArmed = false
        source.stop()
    }

    /// Re-requests the snapshot (manual retry + the stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// The View affordance — navigates the host to the achievement's lifetime deep link and dismisses
    /// the acknowledged toast (web `handleView`: `onDismiss()` then `navigate(...)`).
    public func view(eventID: String) {
        let route = AchievementUnlockListenerRoute.lifetime(achievementID: eventID)
        source.dismiss(id: eventID)
        onView?(route)
    }

    /// Dismisses a toast (web dismiss `×` + the auto-dismiss timeout).
    public func dismiss(eventID: String) {
        source.dismiss(id: eventID)
    }

    private func apply(_ input: AchievementUnlockListenerInput) {
        self.input = input
        resolved = AchievementUnlockListenerProjection.resolve(input, config: config, strings: strings)

        playChimeIfNewUnlock(input)
        autoRefreshIfBecameStale(input)
        syncAutoDismiss()
    }

    /// Plays the unlock chime when the queue grows while `playSound` is on — the native parity of the
    /// web `useEffect([recent.length, prefs.playSound])`. The documented web intent is to chime once
    /// per new unlock (`dismiss()` removes acknowledged entries), so we trigger on a count *increase*,
    /// never on a dismiss-driven decrease. Independent of the toast opt-out (the web effect runs before
    /// the `!showToasts` early return).
    private func playChimeIfNewUnlock(_ input: AchievementUnlockListenerInput) {
        let count = input.events.count
        defer { lastEventCount = count }
        guard count > lastEventCount, input.prefs.playSound else { return }
        chime.play(.celebration)
    }

    /// One-shot auto-refresh on the rising edge into the stale window (P4 leaf contract). Never armed
    /// while offline — there is no connection to re-fetch over.
    private func autoRefreshIfBecameStale(_ input: AchievementUnlockListenerInput) {
        let previous = lastConnection
        lastConnection = input.connection
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Reconciles the per-toast auto-dismiss countdown with the visible stack. New toasts start at the
    /// configured lifetime; toasts that have left the stack drop their counter; the ticker runs only
    /// while at least one toast is visible (the web per-toast `setTimeout` only exists while the toast
    /// is mounted, so a suppressed / empty surface never counts down).
    private func syncAutoDismiss() {
        guard resolved.isPresentingToasts else {
            remaining.removeAll()
            disarmTicker()
            return
        }
        let visible = Set(resolved.toasts.map(\.id))
        remaining = remaining.filter { visible.contains($0.key) }
        for id in visible where remaining[id] == nil {
            remaining[id] = config.autoDismissSeconds
        }
        if remaining.isEmpty {
            disarmTicker()
        } else {
            armTicker()
        }
    }

    private func armTicker() {
        guard !tickerArmed else { return }
        tickerArmed = true
        ticker.start(interval: 1) { [weak self] in self?.tick() }
    }

    private func disarmTicker() {
        guard tickerArmed else { return }
        tickerArmed = false
        ticker.stop()
    }

    private func tick() {
        for id in remaining.keys {
            remaining[id, default: 0] -= 1
        }
        let expired = remaining.filter { $0.value <= 0 }.map(\.key)
        for id in expired {
            remaining[id] = nil
        }
        for id in expired {
            source.dismiss(id: id)
        }
        if remaining.isEmpty {
            disarmTicker()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "AchievementUnlockListener" table (the web `achievements.*` toast keys
/// plus the native P4 chrome + a11y keys), folded into the app `Localizable.xcstrings` catalog at
/// integration time; kept per-surface so each parallel prompt owns its own strings.
public enum AchievementUnlockListenerStrings {
    public static let table = "AchievementUnlockListener"

    public static let string: AchievementUnlockListenerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
