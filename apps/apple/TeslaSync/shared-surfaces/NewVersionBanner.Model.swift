//
//  NewVersionBanner.Model.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  "new version available" banner. The view binds through ``NewVersionBannerModel``; no networking
//  lives in the view. The model is the native peer of the web component composed over
//  `useVersionWatcher`: a ``NewVersionBannerSource`` emits the watcher snapshot (the hook output), the
//  model overlays the surface-local dismissal (the web `useState` seeded from sessionStorage), derives
//  the resolved projection, forwards the host's "Reload" handler (web `window.location.reload()`),
//  persists the "Later" dismissal per-version, and auto-refreshes once when the feed transitions to
//  stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`;
/// the production app injects an adapter that forwards to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol NewVersionBannerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogNewVersionBannerTelemetry: NewVersionBannerTelemetry {
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
/// literals. Keys live in the "NewVersionBanner" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time; kept per-surface so each parallel prompt owns its own strings.
public enum NewVersionBannerStrings {
    public static let table = "NewVersionBanner"

    public static let string: NewVersionBannerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``NewVersionBannerSource`` (the native peer of
/// `useVersionWatcher`), owns the surface-local `dismissedVersion` (seeded from the injected
/// ``NewVersionDismissalStore`` — the web sessionStorage seam), recomputes the resolved projection over
/// the combined input, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// forwards the host's "Reload" handler, persists the "Later" dismissal per-version, resets a stale
/// dismissal once the deploy advances (web effect), and auto-refreshes once on a stale transition.
@MainActor
@Observable
public final class NewVersionBannerModel {
    public private(set) var resolved: NewVersionBannerResolved = .init(phase: .loading, data: nil)
    public private(set) var connection: NewVersionConnection = .live

    public var phase: NewVersionBannerResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any NewVersionBannerSource
    @ObservationIgnored private let dismissalStore: any NewVersionDismissalStore
    @ObservationIgnored private let telemetry: any NewVersionBannerTelemetry
    @ObservationIgnored private let onReload: (@MainActor () -> Void)?
    @ObservationIgnored private let onLater: (@MainActor () -> Void)?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var dismissedVersion: String?
    @ObservationIgnored private var lastSnapshot = NewVersionWatcherSnapshot()

    public init(
        source: any NewVersionBannerSource,
        dismissalStore: any NewVersionDismissalStore = InMemoryNewVersionDismissalStore(),
        telemetry: any NewVersionBannerTelemetry = OSLogNewVersionBannerTelemetry(),
        onReload: (@MainActor () -> Void)? = nil,
        onLater: (@MainActor () -> Void)? = nil
    ) {
        self.source = source
        self.dismissalStore = dismissalStore
        self.telemetry = telemetry
        self.onReload = onReload
        self.onLater = onLater
        dismissedVersion = dismissalStore.dismissedVersion
        source.onUpdate = { [weak self] snapshot in self?.apply(snapshot) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event exactly once per instance.
    /// Idempotent across the SwiftUI appear/disappear churn — a later ``start()`` after ``stop()`` does
    /// not re-emit.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: NewVersionBannerSurface.slug)
        }
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream version probe (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Invokes the host's "Reload" handler — the native peer of the web `window.location.reload()`.
    /// A native app has no page reload (it updates through the App Store), so the host wires this to
    /// its chosen refresh (re-bootstrap the shell, reload embedded web content, or open the update
    /// flow). A no-op when the host supplies none.
    public func reload() {
        onReload?()
    }

    /// Dismisses the banner for the current version — the native peer of the web `handleLater`. Stores
    /// the dismissal per-version (web sessionStorage) so it does not carry forward to the next deploy,
    /// then recomputes. A no-op when no latest version is known (web `if (latestVersion)`).
    public func dismiss() {
        guard let latest = lastSnapshot.latestVersion else { return }
        dismissedVersion = latest
        dismissalStore.setDismissed(latest)
        recompute()
        onLater?()
    }

    private func apply(_ snapshot: NewVersionWatcherSnapshot) {
        lastSnapshot = snapshot
        // Web effect: a dismissal for an older build does not carry forward to a newer deploy.
        let retained = NewVersionDismissalReset.resolve(
            dismissedVersion: dismissedVersion,
            latestVersion: snapshot.latestVersion
        )
        if retained != dismissedVersion {
            dismissedVersion = retained
            dismissalStore.setDismissed(retained)
        }
        let previous = connection
        connection = snapshot.connection
        recompute()
        // Stale → one-shot auto-refresh on the transition (re-armed on return to live).
        if snapshot.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    private func recompute() {
        resolved = NewVersionBannerProjection.resolve(
            NewVersionBannerInput(snapshot: lastSnapshot, dismissedVersion: dismissedVersion)
        )
    }
}
