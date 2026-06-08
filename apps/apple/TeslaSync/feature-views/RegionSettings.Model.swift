//
//  RegionSettings.Model.swift
//  TeslaSync — P4 feature view · 0211 · RegionSettings (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the toast seam, and
//  the i18n facade (P1/S10) for the Region & API settings panel. The view binds
//  through `RegionSettingsModel`; no networking lives in the view. The web source
//  (RegionSettings.tsx) reads `useTeslaUserRegion()` and mutates via
//  `useRefreshTeslaRegion()`, surfacing success/failure through `useToast()`. The
//  input snapshot here carries that query's resolved envelope (plus its loading /
//  error / refreshing state and connectivity) rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the `regionConfig?.data?.region`
//  data-vs-empty render, the `fetched_at` "Synced …" caption, the pending refresh
//  spinner). On top of those, this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) fed by the query state, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol RegionSettingsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogRegionSettingsTelemetry: RegionSettingsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (web `useToast()` success / error)

/// The outcome of a region refresh — the native mirror of the web mutation's
/// `onSuccess` / `onError` branches.
public enum RegionRefreshOutcome: Sendable, Equatable {
    case succeeded
    case failed(String)
}

/// Presents the post-refresh toast (web `useToast().success` / `.error`). The
/// default logs; the production app injects the shared toast presenter.
public protocol RegionSettingsToast: Sendable {
    func success(_ message: String)
    func error(_ title: String, _ detail: String)
}

/// `os.Logger`-backed default toast presenter (no UI; used in previews/tests).
public struct OSLogRegionSettingsToast: RegionSettingsToast {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "toast") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func success(_ message: String) {
        logger.info("toast.success \(message, privacy: .public)")
    }

    public func error(_ title: String, _ detail: String) {
        logger.error("toast.error \(title, privacy: .public): \(detail, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum RegionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web query + mutation state from useUser.ts)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `useTeslaUserRegion()` result (`config`), the parent surface's lifecycle
/// (`isLoading`, an error message), the `useRefreshTeslaRegion()` pending flag
/// (`isRefreshing`), and connectivity. The config values are read SI-free strings
/// from the API, so no conversion applies at this layer.
public struct RegionSettingsInput: Sendable, Equatable {
    public var config: RegionRecord?
    public var isLoading: Bool
    public var errorMessage: String?
    public var isRefreshing: Bool
    public var connection: RegionConnection

    public init(
        config: RegionRecord? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        isRefreshing: Bool = false,
        connection: RegionConnection = .live
    ) {
        self.config = config
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.isRefreshing = isRefreshing
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render
/// branches. `phase` selects the body; `region` / `fleetAPIBaseURL` are the
/// pre-shaped cell values, `fetchedAtLabel` is the formatted "Synced" timestamp
/// (nil when the API has never synced), and `isRefreshing` drives the header
/// button's spinner. The view is a pure function of this value.
public struct RegionSettingsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let region: String
    public let fleetAPIBaseURL: String
    public let fetchedAtLabel: String?
    public let isRefreshing: Bool

    public init(
        phase: Phase,
        region: String,
        fleetAPIBaseURL: String,
        fetchedAtLabel: String?,
        isRefreshing: Bool
    ) {
        self.phase = phase
        self.region = region
        self.fleetAPIBaseURL = fleetAPIBaseURL
        self.fetchedAtLabel = fetchedAtLabel
        self.isRefreshing = isRefreshing
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data and the timestamp / refreshing
/// flags. Locale + time zone are injected so the timestamp is deterministic.
public enum RegionSettingsProjection {
    public static func resolve(
        _ input: RegionSettingsInput,
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) -> RegionSettingsResolved {
        let label = input.config?.fetchedAt.map {
            RegionFormat.dateTime($0, locale: locale, timeZone: timeZone)
        }

        // P4 contract: a query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), input, label: label)
        }
        // Initial fetch (web query pending) or no snapshot yet.
        guard !input.isLoading, let config = input.config else {
            return resolved(.loading, input, label: label)
        }
        let region = RegionFormat.region(config.region)
        // Web empty render: `regionConfig?.data?.region` is falsy.
        guard !region.isEmpty else {
            return resolved(.empty, input, label: label)
        }
        return resolved(.data, input, label: label)
    }

    private static func resolved(
        _ phase: RegionSettingsResolved.Phase,
        _ input: RegionSettingsInput,
        label: String?
    ) -> RegionSettingsResolved {
        RegionSettingsResolved(
            phase: phase,
            region: RegionFormat.region(input.config?.region),
            fleetAPIBaseURL: RegionFormat.fleetURL(input.config?.fleetAPIBaseURL),
            fetchedAtLabel: label,
            isRefreshing: input.isRefreshing
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// `useTeslaUserRegion()` query + `useRefreshTeslaRegion()` mutation; previews and
/// tests use `InMemoryRegionSettingsSource`. The view never talks to the network.
@MainActor
public protocol RegionSettingsSource: AnyObject {
    var onUpdate: (@MainActor (RegionSettingsInput) -> Void)? { get set }
    var onRefreshOutcome: (@MainActor (RegionRefreshOutcome) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `RegionSettingsSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state, the `connection` axis, and the pending-refresh flag, auto-refreshes
/// once when the feed transitions to stale, and routes refresh outcomes to the
/// toast presenter (web `useToast()`).
@MainActor
@Observable
public final class RegionSettingsModel {
    public private(set) var resolved: RegionSettingsResolved
    public private(set) var connection: RegionConnection = .live

    public var phase: RegionSettingsResolved.Phase {
        resolved.phase
    }

    public var isRefreshing: Bool {
        resolved.isRefreshing
    }

    @ObservationIgnored private let source: any RegionSettingsSource
    @ObservationIgnored private let telemetry: any RegionSettingsTelemetry
    @ObservationIgnored private let toast: any RegionSettingsToast
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false

    public init(
        source: any RegionSettingsSource,
        telemetry: any RegionSettingsTelemetry = OSLogRegionSettingsTelemetry(),
        toast: any RegionSettingsToast = OSLogRegionSettingsToast(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        self.locale = locale
        self.timeZone = timeZone
        resolved = RegionSettingsProjection.resolve(
            RegionSettingsInput(isLoading: true),
            locale: locale,
            timeZone: timeZone
        )
        source.onUpdate = { [weak self] input in self?.apply(input) }
        source.onRefreshOutcome = { [weak self] outcome in self?.handle(outcome) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RegionSettings.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the region config (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: RegionSettingsInput) {
        resolved = RegionSettingsProjection.resolve(input, locale: locale, timeZone: timeZone)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func handle(_ outcome: RegionRefreshOutcome) {
        switch outcome {
        case .succeeded:
            toast.success(RegionStrings.string("toast.regionRefreshed", "Region info refreshed"))
        case let .failed(detail):
            toast.error(
                RegionStrings.string("toast.regionFailed", "Failed to refresh region"),
                detail
            )
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)` and
/// `completeRefresh(_:)`.
@MainActor
public final class InMemoryRegionSettingsSource: RegionSettingsSource {
    public var onUpdate: (@MainActor (RegionSettingsInput) -> Void)?
    public var onRefreshOutcome: (@MainActor (RegionRefreshOutcome) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RegionSettingsInput?

    public init(initial: RegionSettingsInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: RegionSettingsInput) {
        onUpdate?(input)
    }

    /// Reports a refresh outcome to the bound model (test/preview affordance).
    public func completeRefresh(_ outcome: RegionRefreshOutcome) {
        onRefreshOutcome?(outcome)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "RegionSettings" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum RegionStrings {
    public static let table = "RegionSettings"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
