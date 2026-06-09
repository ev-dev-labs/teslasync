//
//  UpdateAvailableCallout.Model.swift
//  TeslaSync — P4 feature view · 0259 · UpdateAvailableCallout (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n
//  facade (P1/S10). The view binds through `UpdateAvailableModel`; no networking lives in
//  the view. The web component is a presentational leaf fed by SystemStatusPage's
//  `useQuery(['system-status','update-check'])` — so the source here carries that query's
//  snapshot (`current` / `latest` / `update_available` / `checked_at`) plus its load +
//  freshness lifecycle, and the model reproduces the parent's `hasUpdate` mount gate.
//
//  Deliberately split: the projection lives in the Foundation-only Adapter; this file owns
//  the observable wiring + the seams the production app injects (a real update-check query
//  source, the shared telemetry sink, the localized-strings bundle).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol UpdateAvailableTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. The
/// slug is a static, non-identifying constant; no payload, VIN, or location is recorded.
public struct OSLogUpdateAvailableTelemetry: UpdateAvailableTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from SystemStatusPage + the update-check query)

/// One coalesced snapshot of the component's inputs — the load state of the parent's
/// `/system/update-check` query plus the connection freshness. The production source
/// composes this from the query result + the network monitor; previews/tests construct it
/// directly.
public struct UpdateAvailableInput: Sendable, Equatable {
    public var loadState: UpdateCheckLoadState
    public var connection: UpdateConnection

    public init(
        loadState: UpdateCheckLoadState,
        connection: UpdateConnection = .live
    ) {
        self.loadState = loadState
        self.connection = connection
    }

    /// Convenience: a loaded snapshot with the given fields.
    public static func loaded(
        current: String? = nil,
        latest: String? = nil,
        updateAvailable: Bool = true,
        checkedAt: Date? = nil,
        connection: UpdateConnection = .live
    ) -> UpdateAvailableInput {
        UpdateAvailableInput(
            loadState: .loaded(UpdateCheckSnapshot(
                current: current,
                latest: latest,
                updateAvailable: updateAvailable,
                checkedAt: checkedAt
            )),
            connection: connection
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent's
/// update-check query (for the snapshot) composed with the network monitor (for freshness);
/// previews + tests use `InMemoryUpdateAvailableSource`. The view never talks to the
/// network directly.
@MainActor
public protocol UpdateAvailableSource: AnyObject {
    var onUpdate: (@MainActor (UpdateAvailableInput) -> Void)? { get set }
    func start()
    func stop()
    /// Re-requests the update-check query (wired to a manual refresh / the stale window).
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `UpdateAvailableSource`, recomputes
/// the resolved phase (web parent `hasUpdate` gate + the leaf's three fragments), and exposes
/// it for SwiftUI to switch over. Emits `view.opened` once, the first time the callout is
/// actually presented (mirroring the web component, which renders no DOM until `hasUpdate`).
@MainActor
@Observable
public final class UpdateAvailableModel {
    /// The resolved render phase (web `{hasUpdate && <callout/>}`).
    public private(set) var phase: UpdateAvailablePhase = .idle(.awaitingCheck)

    @ObservationIgnored private let source: any UpdateAvailableSource
    @ObservationIgnored private let telemetry: any UpdateAvailableTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didReportOpen = false

    public init(
        source: any UpdateAvailableSource,
        telemetry: any UpdateAvailableTelemetry = OSLogUpdateAvailableTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing the upstream query. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the update-check query (wired to a manual refresh affordance).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: UpdateAvailableInput) {
        phase = UpdateAvailableProjection.resolve(
            loadState: input.loadState,
            connection: input.connection,
            locale: locale,
            timeZone: timeZone
        )
        reportOpenIfPresented()
    }

    /// Emits `view.opened` the first time the callout is presented — the web component emits
    /// no DOM (and thus no surface impression) until `hasUpdate` is true.
    private func reportOpenIfPresented() {
        guard !didReportOpen, phase.isPresented else { return }
        didReportOpen = true
        telemetry.viewOpened(surface: UpdateAvailableCalloutSurface.slug)
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryUpdateAvailableSource: UpdateAvailableSource {
    public var onUpdate: (@MainActor (UpdateAvailableInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: UpdateAvailableInput?

    public init(initial: UpdateAvailableInput? = nil) {
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
    public func push(_ input: UpdateAvailableInput) {
        onUpdate?(input)
    }
}

// MARK: - Surface identity (P1/S11 `view.opened`)

/// Stable, non-identifying identity for the surface. Shared by the view, the model, and the
/// tests so the diagnostics slug never drifts.
public enum UpdateAvailableCalloutSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "UpdateAvailableCallout"
}

// MARK: - Localization facade (P1/S10) — promotes the web English literals

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "UpdateAvailableCallout" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum UAStrings {
    public static let table = "UpdateAvailableCallout"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
