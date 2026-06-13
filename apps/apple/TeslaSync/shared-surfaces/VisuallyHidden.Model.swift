//
//  VisuallyHidden.Model.swift
//  TeslaSync — P4 shared surface · 0003 · VisuallyHidden (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the announcement-presenter
//  seam, the i18n facade (P1/S10), and the pure projection for the visually-hidden utility.
//  The view binds through `VisuallyHiddenModel`; no networking or assistive-tech posting lives
//  in the view. The web source renders the three hidden render modes and (through its
//  `useAnnouncer` data source) voices each newly-arrived live-region message; the native model
//  keeps the same data contract — a source emits the recent-announcement snapshot plus the
//  parent's loading / error / connectivity state, the model derives the latest polite +
//  assertive region content over it, and posts each newly-arrived message to the assistive
//  technology through the presenter seam.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core
/// diagnostics sink (consent-gated + redacted there). The slug is a static, non-identifying
/// constant.
public protocol VisuallyHiddenTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`
/// event.
public struct OSLogVisuallyHiddenTelemetry: VisuallyHiddenTelemetry {
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
/// `AccessibilityVisuallyHiddenPresenter` (which posts an `AccessibilityNotification`); tests
/// inject a recording double; the model default logs so previews never emit live speech.
@MainActor
public protocol VisuallyHiddenPresenter {
    func announce(_ message: VisuallyHiddenMessage)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology,
/// so previews and headless models run quietly.
@MainActor
public struct OSLogVisuallyHiddenPresenter: VisuallyHiddenPresenter {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: VisuallyHiddenMessage) {
        logger.info("announce priority=\(message.priority.rawValue, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound announcement feed — the orthogonal connectivity axis rendered as
/// the freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum VisuallyHiddenConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (recent announcements + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the recent announcements (the native mirror
/// of the messages the web live regions have received) plus the parent's lifecycle
/// (`isLoading`, an error message, and connectivity). The messages are already-built
/// `VisuallyHiddenMessage` values, exactly as the web `announce(...)` produces the padded
/// region text before it is written.
public struct VisuallyHiddenInput: Sendable, Equatable {
    public var messages: [VisuallyHiddenMessage]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: VisuallyHiddenConnection

    public init(
        messages: [VisuallyHiddenMessage] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VisuallyHiddenConnection = .live
    ) {
        self.messages = messages
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }

    /// The latest polite message (the last value routed to the polite region).
    public var latestPolite: VisuallyHiddenMessage? {
        messages.last { $0.priority == .polite }
    }

    /// The latest assertive message (the last value routed to the assertive region).
    public var latestAssertive: VisuallyHiddenMessage? {
        messages.last { $0.priority == .assertive }
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and for the data / empty phases
/// the latest live-region content (polite + assertive) and the recent history
/// (most-recent-first) are pre-computed so the view is a pure function of this value.
public struct VisuallyHiddenResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let polite: VisuallyHiddenMessage?
    public let assertive: VisuallyHiddenMessage?
    public let recent: [VisuallyHiddenMessage]

    public init(
        phase: Phase,
        polite: VisuallyHiddenMessage?,
        assertive: VisuallyHiddenMessage?,
        recent: [VisuallyHiddenMessage]
    ) {
        self.phase = phase
        self.polite = polite
        self.assertive = assertive
        self.recent = recent
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the
/// announcer's read-time derivation (latest polite + assertive) plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data and the region derivation.
public enum VisuallyHiddenProjection {
    public static func resolve(_ input: VisuallyHiddenInput) -> VisuallyHiddenResolved {
        // P4 contract: a source query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return VisuallyHiddenResolved(phase: .error(message), polite: nil, assertive: nil, recent: [])
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return VisuallyHiddenResolved(phase: .loading, polite: nil, assertive: nil, recent: [])
        }
        // Resolved with no announcements yet → friendly empty state (the mode catalog still
        // renders; the live regions read as not-yet-written, the web initial empty strings).
        guard !input.messages.isEmpty else {
            return VisuallyHiddenResolved(phase: .empty, polite: nil, assertive: nil, recent: [])
        }
        let ordered = input.messages.sorted { $0.id > $1.id }
        return VisuallyHiddenResolved(
            phase: .data,
            polite: input.latestPolite,
            assertive: input.latestAssertive,
            recent: ordered
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `VisuallyHiddenSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection`
/// axis, posts each newly-arrived announcement to the assistive technology through the
/// presenter (web live-region voicing parity), and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class VisuallyHiddenModel {
    public private(set) var resolved: VisuallyHiddenResolved =
        .init(phase: .loading, polite: nil, assertive: nil, recent: [])
    public private(set) var connection: VisuallyHiddenConnection = .live

    public var phase: VisuallyHiddenResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any VisuallyHiddenSource
    @ObservationIgnored private let telemetry: any VisuallyHiddenTelemetry
    @ObservationIgnored private let presenter: any VisuallyHiddenPresenter
    @ObservationIgnored private var started = false
    @ObservationIgnored private var lastAnnouncedID = 0

    public init(
        source: any VisuallyHiddenSource,
        telemetry: any VisuallyHiddenTelemetry = OSLogVisuallyHiddenTelemetry(),
        presenter: any VisuallyHiddenPresenter = OSLogVisuallyHiddenPresenter()
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
        telemetry.viewOpened(surface: VisuallyHidden.surfaceSlug)
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

    private func apply(_ input: VisuallyHiddenInput) {
        resolved = VisuallyHiddenProjection.resolve(input)
        let previous = connection
        connection = input.connection
        voice(input.messages)
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }

    /// Posts every announcement newer than the last voiced sequence, in arrival order, then
    /// advances the watermark — so each message is spoken exactly once even as the snapshot is
    /// re-pushed on connectivity changes.
    private func voice(_ messages: [VisuallyHiddenMessage]) {
        let fresh = messages.filter { $0.id > lastAnnouncedID }.sorted { $0.id < $1.id }
        for message in fresh {
            presenter.announce(message)
        }
        if let maxID = messages.map(\.id).max(), maxID > lastAnnouncedID {
            lastAnnouncedID = maxID
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "VisuallyHidden" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings.
public enum VisuallyHiddenStrings {
    public static let table = "VisuallyHidden"

    public static let string: VisuallyHiddenResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
