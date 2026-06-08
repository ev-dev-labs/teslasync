//
//  FeatureToggles.Model.swift
//  TeslaSync — P4 feature view · 0205 · FeatureToggles (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + toast seam
//  (web `useToast`) + i18n facade (P1/S10) for the Tesla "Feature Flags" surface.
//  The view binds through `FeatureTogglesModel`; no networking lives in the view.
//  SwiftUI parity of features/settings/components/FeatureToggles.tsx.
//
//  The web component reads `useTeslaFeatureConfig()` (the displayed config) and
//  `useRefreshTeslaFeatureConfig()` (the POST refresh mutation that, on settle,
//  fires a success / error toast). The native surface reproduces that whole
//  lifecycle through a `FeatureTogglesSource`: the production app wires it to the
//  shared P1/S8 state holder for `/tesla/user/feature-config`, and the refresh
//  button / stale auto-refresh both drive `source.refresh()`. Every prompt state
//  (loading / empty / error / stale / offline / content) resolves here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated
/// and redacted there.
public protocol FeatureTogglesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFeatureTogglesTelemetry: FeatureTogglesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Toast seam (web `useToast`)

/// The refresh-result toast seam — the native parity of the web `useToast`
/// `success` / `error` calls fired from the refresh mutation's `onSuccess` /
/// `onError`. The default logs; the production app injects the shared toast host.
public protocol FeatureTogglesToast: Sendable {
    func success(message: String)
    func error(message: String, detail: String?)
}

/// `os.Logger`-backed default toast sink (used until the host toast is injected).
public struct OSLogFeatureTogglesToast: FeatureTogglesToast {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "toast")
    }

    public func success(message: String) {
        logger.info("toast.success \(message, privacy: .public)")
    }

    public func error(message: String, detail: String?) {
        logger.error("toast.error \(message, privacy: .public) detail=\(detail ?? "", privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "FeatureToggles" table,
/// folded into the app `Localizable.xcstrings` master catalog at integration
/// time; the per-surface table keeps each parallel surface prompt self-contained.
public enum FeatureTogglesStrings {
    public static let table = "FeatureToggles"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Count format (e.g. the "{n} features" accessibility summary).
    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Refresh outcome (web mutation `onSuccess` / `onError`)

/// The settled result of a refresh mutation, carried on the next snapshot so the
/// model can fire the matching toast exactly once (web `onSuccess` / `onError`).
public enum FeatureTogglesRefreshOutcome: Sendable, Equatable {
    case succeeded
    /// The web `err.message` detail surfaced as the toast's secondary line.
    case failed(String)
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `FeatureTogglesSource`: the raw config map
/// (web `featureConfig.data`) + its load status + the live-state connection + the
/// last-sync timestamp (web `fetched_at`) + an optional settled refresh outcome.
public struct FeatureTogglesUpdate: Sendable, Equatable {
    public var status: FeatureTogglesLoadStatus
    public var connection: FeatureTogglesConnection
    /// The web `featureConfig.data`; `nil` means "no new payload" (keep cached).
    public var config: [String: FeatureConfigValue]?
    /// The web `featureConfig.fetched_at` paired with `config`.
    public var fetchedAt: Date?
    /// Set on the snapshot that settles a refresh; drives the one-shot toast.
    public var refreshOutcome: FeatureTogglesRefreshOutcome?

    public init(
        status: FeatureTogglesLoadStatus = .loading,
        connection: FeatureTogglesConnection = .live,
        config: [String: FeatureConfigValue]? = nil,
        fetchedAt: Date? = nil,
        refreshOutcome: FeatureTogglesRefreshOutcome? = nil
    ) {
        self.status = status
        self.connection = connection
        self.config = config
        self.fetchedAt = fetchedAt
        self.refreshOutcome = refreshOutcome
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — the `useTeslaFeatureConfig` query plus the
/// `useRefreshTeslaFeatureConfig` mutation behind `refresh()`. Previews + tests
/// use `InMemoryFeatureTogglesSource`. The view never talks to the network.
@MainActor
public protocol FeatureTogglesSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (FeatureTogglesUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the refresh mutation (web `featureConfigRefresh.mutate`) / the
    /// stale auto-refetch. A user-initiated call settles with a `refreshOutcome`.
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `FeatureTogglesSource`,
/// projects each snapshot through `FeatureTogglesAdapter`, exposes a render
/// `FeatureTogglesPhase` + freshness for SwiftUI to switch over, fires the refresh
/// toast, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class FeatureTogglesModel {
    public private(set) var phase: FeatureTogglesPhase = .loading
    public private(set) var connection: FeatureTogglesConnection = .live
    public private(set) var projection: FeatureTogglesProjection = .empty
    /// Web `featureConfigRefresh.isPending` — spins the icon + disables the button.
    public private(set) var refreshing = false
    public private(set) var fetchedAt: Date?

    @ObservationIgnored private let source: any FeatureTogglesSource
    @ObservationIgnored private let telemetry: any FeatureTogglesTelemetry
    @ObservationIgnored private let toast: any FeatureTogglesToast
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FeatureTogglesSource,
        telemetry: any FeatureTogglesTelemetry = OSLogFeatureTogglesTelemetry(),
        toast: any FeatureTogglesToast = OSLogFeatureTogglesToast()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.toast = toast
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The localized "Synced {time}" label, or `nil` when no sync time is known
    /// (web `{featureConfig?.fetched_at && t('featureConfig.lastSynced')} {time}`).
    public var syncedLabel: String? {
        guard let formatted = FeatureTogglesFormat.synced(at: fetchedAt) else { return nil }
        let prefix = FeatureTogglesStrings.string("settings.featureConfig.lastSynced", "Synced")
        return "\(prefix) \(formatted)"
    }

    /// The combined VoiceOver summary for the surface.
    public var accessibilitySummary: String {
        FeatureTogglesAccessibility.summary(for: projection)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FeatureTogglesSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// User-initiated refresh (web button `onClick` → mutate). Optimistically
    /// spins the icon; the settling snapshot clears it and fires the toast.
    public func refresh() {
        guard !refreshing else { return }
        refreshing = true
        source.refresh()
    }

    private func apply(_ update: FeatureTogglesUpdate) {
        connection = update.connection
        if let config = update.config {
            projection = FeatureTogglesAdapter.project(config)
            fetchedAt = update.fetchedAt
        }
        phase = FeatureTogglesPhaseResolver.phase(status: update.status, hasData: projection.hasData)
        if let outcome = update.refreshOutcome { settleRefresh(outcome) }
        handleAutoRefresh(for: update.connection)
    }

    /// Clears the in-flight flag and fires the matching toast (web `onSuccess` /
    /// `onError`) exactly once for the settled mutation.
    private func settleRefresh(_ outcome: FeatureTogglesRefreshOutcome) {
        refreshing = false
        switch outcome {
        case .succeeded:
            toast.success(
                message: FeatureTogglesStrings.string(
                    "settings.toast.featureConfigRefreshed",
                    "Feature config refreshed"
                )
            )
        case let .failed(detail):
            toast.error(
                message: FeatureTogglesStrings.string(
                    "settings.toast.featureConfigFailed",
                    "Failed to refresh feature config"
                ),
                detail: detail.isEmpty ? nil : detail
            )
        }
    }

    /// Stale → one guarded silent auto-refetch (prompt "stale chip + auto-refresh"),
    /// re-armed once live so a later stale episode re-triggers exactly once. The
    /// auto-refresh carries no toast outcome (silent); offline keeps cached config.
    private func handleAutoRefresh(for connection: FeatureTogglesConnection) {
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

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFeatureTogglesSource: FeatureTogglesSource {
    public var onUpdate: (@MainActor (FeatureTogglesUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FeatureTogglesUpdate?

    public init(initial: FeatureTogglesUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: FeatureTogglesUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver strings. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum FeatureTogglesAccessibility {
    /// The container summary: feature count + enabled count, or the empty message.
    public static func summary(for projection: FeatureTogglesProjection) -> String {
        let title = FeatureTogglesStrings.string("settings.featureConfig.title", "Feature Flags")
        guard projection.hasData else {
            let empty = FeatureTogglesStrings.string(
                "settings.featureConfig.noData",
                "No feature config data yet. Click Refresh to fetch from Tesla."
            )
            return "\(title): \(empty)"
        }
        let count = FeatureTogglesStrings.count(
            "settings.featureConfig.a11y.count",
            "%lld features",
            projection.entries.count
        )
        let enabled = FeatureTogglesStrings.count(
            "settings.featureConfig.a11y.enabled",
            "%lld enabled",
            projection.enabledCount
        )
        return "\(title): \(count), \(enabled)"
    }

    /// One row's VoiceOver value: "{key}: {Enabled|Disabled}{, details}".
    public static func rowLabel(_ entry: FeatureToggleEntry) -> String {
        let status = FeatureTogglesStrings.string(
            entry.enabled ? "settings.featureConfig.enabled" : "settings.featureConfig.disabled",
            entry.enabled ? "Enabled" : "Disabled"
        )
        guard let details = entry.details, !details.isEmpty else { return "\(entry.key): \(status)" }
        return "\(entry.key): \(status), \(details)"
    }
}

// MARK: - Surface identity

public extension FeatureToggles {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FeatureTogglesSurface.slug
    }
}
