//
//  AnnouncerRegion.Model.swift
//  TeslaSync — P4 shared surface · 0001 · AnnouncerRegion (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the announcement-presenter
//  seam, the i18n facade (P1/S10), and the pure projection for the global screen-reader
//  announcer. The view binds through `AnnouncerRegionModel`; no networking or assistive-tech
//  posting lives in the view. The web source subscribes to the announcer via
//  `subscribeAnnouncer` and keeps the latest polite + assertive message in component state;
//  the native model keeps the same data contract — a source emits the recent-announcement
//  snapshot plus the parent's loading / error / connectivity state, the model derives the
//  polite/assertive regions over it, and posts each newly-arrived message to the assistive
//  technology through the presenter seam (the native parity of the web live region voicing).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying
/// constant.
public protocol AnnouncerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event.
public struct OSLogAnnouncerTelemetry: AnnouncerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement presenter seam (native parity of the web aria-live voicing)

/// Posts an announcement to the assistive technology — the native boundary that replaces the
/// web `aria-live` region's automatic voicing. The view injects
/// `AccessibilityAnnouncementPresenter` (which posts an `AccessibilityNotification`); tests
/// inject a recording double; the model default logs so previews never emit live speech.
@MainActor
public protocol AnnouncementPresenter {
    func announce(_ message: AnnouncerMessage)
}

/// `os.Logger`-backed default that records the intent without driving the assistive
/// technology, so previews and headless models run quietly.
@MainActor
public struct OSLogAnnouncementPresenter: AnnouncementPresenter {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: AnnouncerMessage) {
        logger.info("announce priority=\(message.priority.rawValue, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound announcement feed — the orthogonal connectivity axis rendered
/// as the freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum AnnouncerConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (recent announcements + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the recent announcements (ascending by
/// sequence, the native mirror of the messages the web regions have received) plus the
/// parent's lifecycle (`isLoading`, an error message, and connectivity). The messages are
/// already-built `AnnouncerMessage` values, exactly as the web `announce(...)` produces the
/// padded region text before it is written.
public struct AnnouncerRegionInput: Sendable, Equatable {
    public var entries: [AnnouncerMessage]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AnnouncerConnection

    public init(
        entries: [AnnouncerMessage] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AnnouncerConnection = .live
    ) {
        self.entries = entries
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// The latest polite message (web `polite` state — the last value routed to the polite
    /// region).
    public var latestPolite: AnnouncerMessage? {
        entries.last { $0.priority == .polite }
    }

    /// The latest assertive message (web `assertive` state — the last value routed to the
    /// assertive region).
    public var latestAssertive: AnnouncerMessage? {
        entries.last { $0.priority == .assertive }
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data phase the two
/// live regions (latest polite + latest assertive) and the recent history (most-recent-first)
/// are pre-computed so the view is a pure function of this value.
public struct AnnouncerRegionResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let polite: AnnouncerMessage?
    public let assertive: AnnouncerMessage?
    public let entries: [AnnouncerMessage]

    public init(
        phase: Phase,
        polite: AnnouncerMessage?,
        assertive: AnnouncerMessage?,
        entries: [AnnouncerMessage]
    ) {
        self.phase = phase
        self.polite = polite
        self.assertive = assertive
        self.entries = entries
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of
/// the announcer's read-time derivation (latest polite + assertive) plus the P4 leaf
/// contract. Unit tested across loading / empty / error / data and the region derivation.
public enum AnnouncerRegionProjection {
    public static func resolve(_ input: AnnouncerRegionInput) -> AnnouncerRegionResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return AnnouncerRegionResolved(phase: .error(message), polite: nil, assertive: nil, entries: [])
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return AnnouncerRegionResolved(phase: .loading, polite: nil, assertive: nil, entries: [])
        }
        // Resolved with no announcements yet → friendly empty state (never blank), the web
        // initial regions that start as empty strings.
        guard !input.entries.isEmpty else {
            return AnnouncerRegionResolved(phase: .empty, polite: nil, assertive: nil, entries: [])
        }
        let ordered = input.entries.sorted { $0.id > $1.id }
        return AnnouncerRegionResolved(
            phase: .data,
            polite: input.latestPolite,
            assertive: input.latestAssertive,
            entries: ordered
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to an `AnnouncerRegionSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, posts each newly-arrived announcement to the assistive technology
/// through the presenter (web live-region voicing parity), and auto-refreshes once when the
/// feed transitions to stale.
@MainActor
@Observable
public final class AnnouncerRegionModel {
    public private(set) var resolved: AnnouncerRegionResolved =
        .init(phase: .loading, polite: nil, assertive: nil, entries: [])
    public private(set) var connection: AnnouncerConnection = .live

    public var phase: AnnouncerRegionResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AnnouncerRegionSource
    @ObservationIgnored private let telemetry: any AnnouncerTelemetry
    @ObservationIgnored private let presenter: any AnnouncementPresenter
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastAnnouncedID = 0

    public init(
        source: any AnnouncerRegionSource,
        telemetry: any AnnouncerTelemetry = OSLogAnnouncerTelemetry(),
        presenter: any AnnouncementPresenter = OSLogAnnouncementPresenter()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.presenter = presenter
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AnnouncerRegion.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AnnouncerRegionInput) {
        resolved = AnnouncerRegionProjection.resolve(input)
        let previous = connection
        connection = input.connection
        voice(input.entries)
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Posts every announcement newer than the last voiced sequence, in arrival order, then
    /// advances the watermark — so each message is spoken exactly once even as the snapshot is
    /// re-pushed on connectivity changes.
    private func voice(_ entries: [AnnouncerMessage]) {
        let fresh = entries.filter { $0.id > lastAnnouncedID }.sorted { $0.id < $1.id }
        for message in fresh {
            presenter.announce(message)
        }
        if let maxID = entries.map(\.id).max(), maxID > lastAnnouncedID {
            lastAnnouncedID = maxID
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AnnouncerRegion" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum AnnouncerRegionStrings {
    public static let table = "AnnouncerRegion"

    public static let string: AnnouncerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
