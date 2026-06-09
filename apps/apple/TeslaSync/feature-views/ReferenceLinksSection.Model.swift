//
//  ReferenceLinksSection.Model.swift
//  TeslaSync — P4 feature view · 0007 · ReferenceLinksSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the developer reference-links section. The view binds through
//  `ReferenceLinksModel`; no networking lives in the view. The web source
//  (ReferenceLinksSection.tsx) is a pure presentational leaf that maps a static
//  `REFERENCE_LINKS` array, so the input snapshot here carries that catalog (plus a
//  loading / error / connectivity lifecycle) rather than issuing HTTP itself — a
//  remote-gated catalog (feature flags / entitlements) then renders the same chrome.
//
//  States: the web leaf renders exactly one branch (the grid of link cards). On top
//  of it this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) and an orthogonal `connection` axis
//  (live / stale / offline) surfaced as a freshness chip + banner with a one-shot
//  auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol ReferenceLinksTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogReferenceLinksTelemetry: ReferenceLinksTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound catalog — the orthogonal connectivity axis rendered as
/// the freshness chip + banner. `live` hides both; `stale` / `offline` show them.
public enum ReferenceLinksConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web `REFERENCE_LINKS` + parent lifecycle)

/// One coalesced snapshot of the section's inputs — the native mirror of the web
/// static catalog (`links`) plus the surface lifecycle (`isLoading`, an error
/// message, and connectivity). `links == nil` models the pre-resolution state; an
/// empty array models a resolved-but-empty catalog.
public struct ReferenceLinksInput: Sendable, Equatable {
    public var links: [ReferenceLink]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: ReferenceLinksConnection

    public init(
        links: [ReferenceLink]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: ReferenceLinksConnection = .live
    ) {
        self.links = links
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the section's render
/// branch. `phase` selects the body; `links` carries the resolved catalog the grid
/// renders, so the view is a pure function of this value.
public struct ReferenceLinksResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let links: [ReferenceLink]

    public init(phase: Phase, links: [ReferenceLink]) {
        self.phase = phase
        self.links = links
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's single render branch plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data.
public enum ReferenceLinksProjection {
    public static func resolve(_ input: ReferenceLinksInput) -> ReferenceLinksResolved {
        // P4 contract: a parent failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return ReferenceLinksResolved(phase: .error(message), links: input.links ?? [])
        }
        // Initial fetch (parent `isLoading`) or no snapshot yet.
        guard !input.isLoading, let links = input.links else {
            return ReferenceLinksResolved(phase: .loading, links: input.links ?? [])
        }
        // Resolved-but-empty catalog → friendly empty state, never a blank grid.
        guard !links.isEmpty else {
            return ReferenceLinksResolved(phase: .empty, links: [])
        }
        return ReferenceLinksResolved(phase: .data, links: links)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// catalog state holder (static client-side data, optionally remote-gated); previews
/// and tests use `InMemoryReferenceLinksSource`. The view never talks to the network
/// directly.
@MainActor
public protocol ReferenceLinksSource: AnyObject {
    var onUpdate: (@MainActor (ReferenceLinksInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `ReferenceLinksSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class ReferenceLinksModel {
    public private(set) var resolved: ReferenceLinksResolved =
        ReferenceLinksProjection.resolve(ReferenceLinksInput(isLoading: true))
    public private(set) var connection: ReferenceLinksConnection = .live

    public var phase: ReferenceLinksResolved.Phase {
        resolved.phase
    }

    public var links: [ReferenceLink] {
        resolved.links
    }

    @ObservationIgnored private let source: any ReferenceLinksSource
    @ObservationIgnored private let telemetry: any ReferenceLinksTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ReferenceLinksSource,
        telemetry: any ReferenceLinksTelemetry = OSLogReferenceLinksTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ReferenceLinksSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (error retry + connectivity banner refresh).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: ReferenceLinksInput) {
        resolved = ReferenceLinksProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryReferenceLinksSource: ReferenceLinksSource {
    public var onUpdate: (@MainActor (ReferenceLinksInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ReferenceLinksInput?

    public init(initial: ReferenceLinksInput? = nil) {
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
    public func push(_ input: ReferenceLinksInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "ReferenceLinksSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ReferenceLinksStrings {
    public static let table = "ReferenceLinksSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
