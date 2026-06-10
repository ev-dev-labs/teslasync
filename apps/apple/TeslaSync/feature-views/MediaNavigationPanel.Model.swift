//
//  MediaNavigationPanel.Model.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Media & Navigation telemetry panel. The view binds through
//  `MediaNavigationModel`; no networking lives in the view. The web source
//  (MediaNavigationPanel.tsx) is a pure presentational leaf fed `mediaData` and
//  `locationData` props by its parent (the live-telemetry grid), so the input
//  snapshot here carries those two readings (plus the `useUnits` preferences and the
//  parent's loading / error / connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf renders two independent sections, each with its own
//  `data ? <body> : <empty copy>` branch. On top of those, this surface honours the
//  P4 leaf contract (the same one EnergyChargingPanel/0279 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state — `empty` is the
//  both-snapshots-absent case — and an orthogonal `connection` axis (live / stale /
//  offline) surfaced as a freshness chip + banner with a one-shot auto-refresh on the
//  stale transition. The per-section "No media data" / "No location data" copy still
//  renders inside the `data` phase whenever one of the two snapshots is absent.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol MediaNavTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogMediaNavTelemetry: MediaNavTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum MediaNavConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + `useUnits` + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// `mediaData` / `locationData` props and the `useUnits` preferences, plus the parent
/// surface's lifecycle (`isLoading`, an error message, and connectivity). Both
/// readings `nil` is the panel-level empty branch.
public struct MediaNavInput: Sendable, Equatable {
    public var media: MediaNavMedia?
    public var location: MediaNavLocation?
    public var units: MediaNavUnits
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: MediaNavConnection

    public init(
        media: MediaNavMedia? = nil,
        location: MediaNavLocation? = nil,
        units: MediaNavUnits = .metric,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: MediaNavConnection = .live
    ) {
        self.media = media
        self.location = location
        self.units = units
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body and carries the pre-computed projection for the data case,
/// so the view is a pure function of this value.
public struct MediaNavResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with neither snapshot (no media + no location) → friendly empty.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// At least one snapshot resolved → the two-section panel body.
        case data(MediaNavProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's two-section render plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data.
public enum MediaNavProjector {
    public static func resolve(_ input: MediaNavInput) -> MediaNavResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return MediaNavResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return MediaNavResolved(phase: .loading)
        }
        // Panel-level empty: neither section has anything to render.
        if input.media == nil, input.location == nil {
            return MediaNavResolved(phase: .empty)
        }
        return MediaNavResolved(
            phase: .data(MediaNavProjection.make(
                media: input.media,
                location: input.location,
                units: input.units
            ))
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// media + location feeds (`useMediaLatest` / `useLocationLatest` + `useUnits`);
/// previews and tests use `InMemoryMediaNavSource`. The view never talks to the
/// network.
@MainActor
public protocol MediaNavSource: AnyObject {
    var onUpdate: (@MainActor (MediaNavInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `MediaNavSource`, recomputes
/// the resolved projection, exposes a render `phase` + the `connection` axis, and
/// auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class MediaNavigationModel {
    public private(set) var resolved: MediaNavResolved =
        MediaNavProjector.resolve(MediaNavInput(isLoading: true))
    public private(set) var connection: MediaNavConnection = .live

    public var phase: MediaNavResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any MediaNavSource
    @ObservationIgnored private let telemetry: any MediaNavTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MediaNavSource,
        telemetry: any MediaNavTelemetry = OSLogMediaNavTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MediaNavigationPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: MediaNavInput) {
        resolved = MediaNavProjector.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMediaNavSource: MediaNavSource {
    public var onUpdate: (@MainActor (MediaNavInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MediaNavInput?

    public init(initial: MediaNavInput? = nil) {
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
    public func push(_ input: MediaNavInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "MediaNavigationPanel" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum MediaNavStrings {
    public static let table = "MediaNavigationPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
