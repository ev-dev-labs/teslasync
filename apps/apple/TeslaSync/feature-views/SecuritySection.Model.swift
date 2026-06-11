//
//  SecuritySection.Model.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Security section. The view binds through `SecuritySectionModel`; no
//  networking lives in the view. The web source (SecuritySection.tsx) is a pure
//  presentational leaf fed a `securityData` prop (one `SecurityEvent`) plus the live
//  `state` prop (a `VehicleState`) by the Vehicle Detail page, so the input snapshot here
//  carries those two readings (plus the parent's loading / error / connectivity state)
//  rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are `securityData ? <grid> : <EmptyState>`. On top
//  of those, this surface honours the P4 leaf contract (the same one the sibling
//  ClimateSection/0291 ships): a `phase` (loading / empty / error / data) fed by the
//  parent's query state, and an orthogonal `connection` axis (live / stale / offline)
//  surfaced as a freshness chip + banner with a one-shot auto-refresh on the stale
//  transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol SecuritySectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogSecuritySectionTelemetry: SecuritySectionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum SecuritySectionConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props + parent lifecycle)

/// One coalesced snapshot of the section's inputs — the native mirror of the web
/// `securityData` + `state` props, plus the parent surface's lifecycle (`isLoading`, an
/// error message, and connectivity). A `nil` reading is the web `!securityData` empty
/// branch (the whole grid, including the `state`-derived tiles, only renders when a
/// security reading is present).
public struct SecuritySectionInput: Sendable, Equatable {
    public var reading: SecuritySectionReading?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: SecuritySectionConnection

    public init(
        reading: SecuritySectionReading? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: SecuritySectionConnection = .live
    ) {
        self.reading = reading
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the section's render branches.
/// `phase` selects the body and carries the pre-computed projection for the data case,
/// so the view is a pure function of this value.
public struct SecuritySectionResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Initial fetch (web parent `isLoading`) → skeleton chrome.
        case loading
        /// Resolved with no security reading (web `!securityData`) → friendly empty.
        case empty
        /// Parent query failure → retry affordance (web `QueryError` peer).
        case error(String)
        /// A reading resolved → the four-tile grid.
        case data(SecuritySectionProjection)
    }

    public let phase: Phase

    public init(phase: Phase) {
        self.phase = phase
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web component's `securityData ? grid : empty` branch plus the P4 leaf contract.
/// Unit tested across loading / empty / error / data.
public enum SecuritySectionProjector {
    public static func resolve(_ input: SecuritySectionInput) -> SecuritySectionResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return SecuritySectionResolved(phase: .error(message))
        }
        // Initial fetch (web parent `isLoading`) → skeleton.
        guard !input.isLoading else {
            return SecuritySectionResolved(phase: .loading)
        }
        // Web empty branch: no security reading to render.
        guard let reading = input.reading else {
            return SecuritySectionResolved(phase: .empty)
        }
        return SecuritySectionResolved(phase: .data(SecuritySectionProjection.make(reading: reading)))
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the live
/// security feed (`useSecurityLatest` + the vehicle `state`); previews and tests use
/// `InMemorySecuritySectionSource`. The view never talks to the network.
@MainActor
public protocol SecuritySectionSource: AnyObject {
    var onUpdate: (@MainActor (SecuritySectionInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The section's observable view-model. Subscribes to a `SecuritySectionSource`,
/// recomputes the resolved projection, exposes a render `phase` + the `connection` axis,
/// and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class SecuritySectionModel {
    public private(set) var resolved: SecuritySectionResolved =
        SecuritySectionProjector.resolve(SecuritySectionInput(isLoading: true))
    public private(set) var connection: SecuritySectionConnection = .live

    public var phase: SecuritySectionResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any SecuritySectionSource
    @ObservationIgnored private let telemetry: any SecuritySectionTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SecuritySectionSource,
        telemetry: any SecuritySectionTelemetry = OSLogSecuritySectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SecuritySection.surfaceSlug)
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

    private func apply(_ input: SecuritySectionInput) {
        resolved = SecuritySectionProjector.resolve(input)
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
public final class InMemorySecuritySectionSource: SecuritySectionSource {
    public var onUpdate: (@MainActor (SecuritySectionInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SecuritySectionInput?

    public init(initial: SecuritySectionInput? = nil) {
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
    public func push(_ input: SecuritySectionInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "SecuritySection" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum SecuritySectionStrings {
    public static let table = "SecuritySection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the "{{count}} open" windows caption and substitutes the i18next
    /// `{{count}}` interpolation token (also tolerating a single-brace `{count}`). The
    /// count is substituted raw — matching i18next's default interpolation, which does
    /// not group the number.
    public static func windowsOpen(_ count: Int) -> String {
        let template = string("vehicles.detail.windowsOpen", "{{count}} open")
        let value = String(count)
        return template
            .replacingOccurrences(of: "{{count}}", with: value)
            .replacingOccurrences(of: "{count}", with: value)
    }
}
