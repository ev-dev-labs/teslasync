//
//  GasPriceSettings.Model.swift
//  TeslaSync — P4 feature view · 0206 · GasPriceSettings (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the toast seam, and
//  the i18n facade (P1/S10) for the Gas Price Auto-Poll settings panel. The view binds
//  through `GasPriceSettingsModel`; no networking lives in the view. The web source
//  (GasPriceSettings.tsx) reads `useGasPriceStatus()` and mutates via
//  `useToggleGasPrice()` / `useUpdateGasPriceConfig()` / `usePollGasPrice()`, surfacing
//  each success through `useToast().info(...)`. The input snapshot here carries that
//  query's resolved envelope (plus its loading / error state and connectivity) rather
//  than issuing HTTP itself; the three mutations are routed through the source seam and
//  their outcomes back to the toast presenter.
//
//  States: the web leaf is presentational over its hook (optional chaining renders the
//  `—` / `Stopped` / `Never` fallbacks while the query is pending). On top of that
//  this surface honours the P4 leaf contract: a `phase` (loading / empty / error /
//  data) fed by the query state, and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + banner with a one-shot auto-refresh on the
//  stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol GasPriceSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogGasPriceSettingsTelemetry: GasPriceSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (web `useToast()` info / error)

/// Presents the post-mutation toast (web `useToast().info` for the component's success
/// feedback, plus an error path for a failed mutation — the native mirror of the hook
/// `onError` toasts). The default logs; the production app injects the shared presenter.
public protocol GasPriceSettingsToast: Sendable {
    func info(_ message: String)
    func error(_ message: String)
}

/// `os.Logger`-backed default toast presenter (no UI; used in previews/tests).
public struct OSLogGasPriceSettingsToast: GasPriceSettingsToast {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "toast") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func info(_ message: String) {
        logger.info("toast.info \(message, privacy: .public)")
    }

    public func error(_ message: String) {
        logger.error("toast.error \(message, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum GasPriceSettingsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Mutations (web `useToggleGasPrice` / `useUpdateGasPriceConfig` / `usePollGasPrice`)

/// The three mutations the panel issues — used to route a failure back to the right
/// toast (web hook `onError` fallback message).
public enum GasPriceActionKind: Sendable, Equatable {
    case toggle
    case interval
    case poll
}

/// The result the source seam reports back for a mutation — the native mirror of each
/// web mutation settling. Successes carry the data the component's `onSuccess` toast
/// needs (the new enabled state); a failure carries the mutation kind + detail.
public enum GasPriceActionOutcome: Sendable, Equatable {
    case toggled(enabled: Bool)
    case intervalUpdated
    case polled
    case failed(GasPriceActionKind, String)
}

// MARK: - State-holder seam (P1/S8 layer; never HTTP from the view)

/// The seam the view binds through. The production app implements this over the
/// `useGasPriceStatus()` query + the toggle / config / poll mutations; previews and
/// tests use `InMemoryGasPriceSettingsSource`. The view never talks to the network.
@MainActor
public protocol GasPriceSettingsSource: AnyObject {
    var onUpdate: (@MainActor (GasPriceSettingsInput) -> Void)? { get set }
    var onActionOutcome: (@MainActor (GasPriceActionOutcome) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func toggle(enabled: Bool)
    func setInterval(_ interval: GasPollInterval)
    func pollNow()
}

// MARK: - View model

/// The panel's observable view-model. Subscribes to a `GasPriceSettingsSource`,
/// recomputes the resolved projection, exposes the render `phase` + resolved
/// view-state, the `connection` axis, and the transient `isPolling` flag (web
/// `gasPollMut.isPending`), auto-refreshes once when the feed transitions to stale, and
/// routes mutation outcomes to the toast presenter (web `useToast().info`).
@MainActor
@Observable
public final class GasPriceSettingsModel {
    public private(set) var resolved: GasPriceSettingsResolved
    public private(set) var connection: GasPriceSettingsConnection = .live

    /// Whether a manual poll is in flight (web `gasPollMut.isPending` → button spinner).
    public private(set) var isPolling = false

    @ObservationIgnored private let source: any GasPriceSettingsSource
    @ObservationIgnored private let telemetry: any GasPriceSettingsTelemetry
    @ObservationIgnored private let toast: any GasPriceSettingsToast
    @ObservationIgnored private let formatting: GasPriceFormatting
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false

    public init(
        source: any GasPriceSettingsSource,
        formatting: GasPriceFormatting = GasPriceFormatting(),
        telemetry: any GasPriceSettingsTelemetry = OSLogGasPriceSettingsTelemetry(),
        toast: any GasPriceSettingsToast = OSLogGasPriceSettingsToast(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        self.formatting = formatting
        self.locale = locale
        self.timeZone = timeZone
        resolved = GasPriceSettingsProjection.resolve(
            GasPriceSettingsInput(isLoading: true),
            formatting: formatting,
            locale: locale,
            timeZone: timeZone
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
        source.onActionOutcome = { [weak self] outcome in self?.handle(outcome) }
    }

    /// The current render phase (web render gate + P4 leaf contract).
    public var phase: GasPriceSettingsResolved.Phase {
        resolved.phase
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GasPriceSettings.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the status (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Flips auto-poll (web `gasToggleMut.mutate(!enabled)`). The new value is the
    /// negation of the currently resolved state, exactly like the web optimistic read.
    public func toggleAutoPoll() {
        source.toggle(enabled: !resolved.enabled)
    }

    /// Changes the poll cadence (web `gasConfigMut.mutate(value)`). A no-op when the
    /// selection is unchanged so an idle re-emit cannot fan out a redundant request.
    public func selectInterval(_ interval: GasPollInterval) {
        guard interval != resolved.pollInterval else { return }
        source.setInterval(interval)
    }

    /// Triggers an immediate poll (web `gasPollMut.mutate`). Re-entrancy is guarded so a
    /// double-tap cannot fan out two requests; the spinner clears on the outcome.
    public func pollNow() {
        guard !isPolling else { return }
        isPolling = true
        source.pollNow()
    }

    private func apply(_ input: GasPriceSettingsInput) {
        resolved = GasPriceSettingsProjection.resolve(
            input,
            formatting: formatting,
            locale: locale,
            timeZone: timeZone
        )
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ outcome: GasPriceActionOutcome) {
        switch outcome {
        case let .toggled(enabled):
            toast.info(enabled
                ? GasPriceStrings.string("gas.enabled", "Auto-poll enabled")
                : GasPriceStrings.string("gas.disabled", "Auto-poll disabled"))
        case .intervalUpdated:
            toast.info(GasPriceStrings.string("gas.intervalUpdated", "Poll interval updated"))
        case .polled:
            isPolling = false
            toast.info(GasPriceStrings.string("gas.pollTriggered", "Gas price poll triggered"))
        case let .failed(kind, _):
            if kind == .poll {
                isPolling = false
            }
            toast.error(failureMessage(for: kind))
        }
    }

    private func failureMessage(for kind: GasPriceActionKind) -> String {
        switch kind {
        case .toggle:
            GasPriceStrings.string("gas.toggleError", "Failed to toggle gas price tracking")
        case .interval:
            GasPriceStrings.string("gas.intervalError", "Failed to update gas price config")
        case .poll:
            GasPriceStrings.string("gas.pollError", "Failed to poll gas prices")
        }
    }
}

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit/UI tests. Seed it with an initial input and an
/// optional canned action outcome, or drive it manually via `push(_:)` /
/// `pushOutcome(_:)` to script multi-step flows. Records each call so the wiring can be
/// asserted.
@MainActor
public final class InMemoryGasPriceSettingsSource: GasPriceSettingsSource {
    public var onUpdate: (@MainActor (GasPriceSettingsInput) -> Void)?
    public var onActionOutcome: (@MainActor (GasPriceActionOutcome) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var toggleCount = 0
    public private(set) var pollCount = 0
    public private(set) var lastToggled: Bool?
    public private(set) var lastInterval: GasPollInterval?

    private let initial: GasPriceSettingsInput?
    private let outcome: GasPriceActionOutcome?

    public init(initial: GasPriceSettingsInput? = nil, outcome: GasPriceActionOutcome? = nil) {
        self.initial = initial
        self.outcome = outcome
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

    public func toggle(enabled: Bool) {
        toggleCount += 1
        lastToggled = enabled
        if let outcome { onActionOutcome?(outcome) }
    }

    public func setInterval(_ interval: GasPollInterval) {
        lastInterval = interval
        if let outcome { onActionOutcome?(outcome) }
    }

    public func pollNow() {
        pollCount += 1
        if let outcome { onActionOutcome?(outcome) }
    }

    /// Pushes a status snapshot to the bound model (test/preview affordance).
    public func push(_ input: GasPriceSettingsInput) {
        onUpdate?(input)
    }

    /// Pushes a mutation outcome to the bound model (test/preview affordance).
    public func pushOutcome(_ outcome: GasPriceActionOutcome) {
        onActionOutcome?(outcome)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "GasPriceSettings" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. The web source keys
/// (`gas.*`, namespace "settings") are preserved verbatim so a shared catalog resolves
/// identically across web and native.
public enum GasPriceStrings {
    public static let table = "GasPriceSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
