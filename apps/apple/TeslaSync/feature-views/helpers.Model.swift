//
//  helpers.Model.swift
//  TeslaSync — P4 feature view · 0245 · helpers (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the status `helpers` surface. The view binds through
//  `StatusHelpersModel`; no networking lives in the view. The web source
//  (helpers.tsx) is a pure utility module with no data, no props, and no i18n keys of
//  its own, so this surface is a presentational reference: it demonstrates the ported
//  `StatusHelpers` / `StatusFormat` core (the real parity value, consumed by the other
//  native status surfaces exactly as the web status components import helpers.tsx) by
//  rendering a status legend + a formatting reference. Its input snapshot carries the
//  status samples to classify plus an uptime / byte sample to format, alongside the
//  P4 leaf lifecycle (loading / error / connectivity).
//
//  States: a `phase` (loading / empty / error / data) plus an orthogonal `connection`
//  axis (live / stale / offline) surfaced as a freshness chip + banner with a one-shot
//  auto-refresh on the stale transition — the same P4 leaf contract the sibling
//  feature views ship.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol StatusHelpersTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogStatusHelpersTelemetry: StatusHelpersTelemetry {
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
public enum StatusHelpersConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot

/// One coalesced snapshot of the surface's inputs — the status `samples` to classify,
/// the optional `uptimeSeconds` + `byteCount` to format, and the parent lifecycle
/// (`isLoading`, an error message, connectivity). The numeric values are carried raw
/// so the locale formatting happens once, at the view boundary.
public struct StatusHelpersInput: Sendable, Equatable {
    public var samples: [String]
    public var uptimeSeconds: Double?
    public var byteCount: Double?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: StatusHelpersConnection

    public init(
        samples: [String] = [],
        uptimeSeconds: Double? = nil,
        byteCount: Double? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: StatusHelpersConnection = .live
    ) {
        self.samples = samples
        self.uptimeSeconds = uptimeSeconds
        self.byteCount = byteCount
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state + projection (P4 leaf contract)

/// The resolved, view-ready state. `phase` selects the body; the legend rows and the
/// raw uptime / byte values are pre-computed so the view is a pure function of this
/// value (the locale formatting of the numbers stays in the view for determinism).
public struct StatusHelpersResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let legend: [StatusLegendRow]
    public let uptimeSeconds: Double?
    public let byteCount: Double?

    public init(
        phase: Phase,
        legend: [StatusLegendRow],
        uptimeSeconds: Double?,
        byteCount: Double?
    ) {
        self.phase = phase
        self.legend = legend
        self.uptimeSeconds = uptimeSeconds
        self.byteCount = byteCount
    }

    /// Whether the formatting reference section has anything to render.
    public var hasFormatting: Bool {
        uptimeSeconds != nil || byteCount != nil
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the P4 leaf
/// contract (error precedence → loading → empty → data). Unit tested across every
/// branch.
public enum StatusHelpersProjection {
    public static func resolve(_ input: StatusHelpersInput) -> StatusHelpersResolved {
        let legend = StatusHelpersRows.rows(for: input.samples)
        let hasFormatting = input.uptimeSeconds != nil || input.byteCount != nil

        // A parent failure surfaces at the leaf as `error`, regardless of any cached
        // samples still in the snapshot.
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), input: input, legend: legend)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return resolved(.loading, input: input, legend: legend)
        }
        // Nothing to classify and nothing to format → friendly empty state.
        if legend.isEmpty, !hasFormatting {
            return resolved(.empty, input: input, legend: legend)
        }
        return resolved(.data, input: input, legend: legend)
    }

    private static func resolved(
        _ phase: StatusHelpersResolved.Phase,
        input: StatusHelpersInput,
        legend: [StatusLegendRow]
    ) -> StatusHelpersResolved {
        StatusHelpersResolved(
            phase: phase,
            legend: legend,
            uptimeSeconds: input.uptimeSeconds,
            byteCount: input.byteCount
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// status-page query; previews and tests use `InMemoryStatusHelpersSource`. The view
/// never talks to the network directly.
@MainActor
public protocol StatusHelpersSource: AnyObject {
    var onUpdate: (@MainActor (StatusHelpersInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `StatusHelpersSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class StatusHelpersModel {
    public private(set) var resolved: StatusHelpersResolved =
        StatusHelpersProjection.resolve(StatusHelpersInput(isLoading: true))
    public private(set) var connection: StatusHelpersConnection = .live

    public var phase: StatusHelpersResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any StatusHelpersSource
    @ObservationIgnored private let telemetry: any StatusHelpersTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any StatusHelpersSource,
        telemetry: any StatusHelpersTelemetry = OSLogStatusHelpersTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StatusHelpersPanel.surfaceSlug)
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

    private func apply(_ input: StatusHelpersInput) {
        resolved = StatusHelpersProjection.resolve(input)
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
public final class InMemoryStatusHelpersSource: StatusHelpersSource {
    public var onUpdate: (@MainActor (StatusHelpersInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: StatusHelpersInput?

    public init(initial: StatusHelpersInput? = nil) {
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
    public func push(_ input: StatusHelpersInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the English fallback, so the view holds
/// no hardcoded literals. Keys live in the "helpers" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum StatusHelpersStrings {
    public static let table = "helpers"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
