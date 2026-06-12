//
//  WidgetEventFeed.Model.swift
//  TeslaSync — P4 widget primitive · 0005 · WidgetEventFeed (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the WidgetEventFeed primitive. The view binds through `WidgetEventFeedModel`; no
//  networking lives in the view. A source emits the coalesced inputs (the controlled `items` + the
//  web `compact` / `maxItems` / `emptyMessage` props, the feed freshness, plus the parent's loading /
//  error state); the model derives the resolved view-state over them, exposes a render `phase` + the
//  `connection` axis, forwards the host's drill-through handler (web row `href` `Link`), and
//  auto-refreshes once when the feed transitions to stale.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetEventFeedTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetEventFeedTelemetry: WidgetEventFeedTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (controlled items + props + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `items` and the web props
/// (`compact`, `maxItems`, the optional `emptyMessage` override), the feed freshness, plus the
/// parent's lifecycle (`isLoading`, an error message). The view-state is derived purely from this.
public struct WidgetEventFeedInput: Sendable, Equatable {
    public var items: [WidgetEventFeedItem]
    public var compact: Bool
    public var maxItems: Int?
    public var emptyMessage: String?
    public var emptyIconSymbol: String?
    public var connection: WidgetEventFeedConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        items: [WidgetEventFeedItem] = [],
        compact: Bool = false,
        maxItems: Int? = nil,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        connection: WidgetEventFeedConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.items = items
        self.compact = compact
        self.maxItems = maxItems
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.feed` phase the arranged
/// `items` (sorted-desc + sliced to the limit) are pre-computed so the view is a pure function of
/// this value. `emptyMessage` carries the caller's verbatim override for the empty branch.
public struct WidgetEventFeedResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case feed
    }

    public let phase: Phase
    public let items: [WidgetEventFeedItem]
    public let emptyMessage: String?
    public let emptyIconSymbol: String?

    public init(phase: Phase, items: [WidgetEventFeedItem], emptyMessage: String?, emptyIconSymbol: String?) {
        self.phase = phase
        self.items = items
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. The branch priority is: a feed
/// failure (`error`) → the initial fetch (`loading`) → the arranged list (`feed`, the web timeline) →
/// the friendly empty state (web `EmptyState`, never a blank box). The connectivity axis does not gate
/// the list — it surfaces as the freshness chip above it. Unit tested across every branch.
public enum WidgetEventFeedProjection {
    public static func resolve(input: WidgetEventFeedInput) -> WidgetEventFeedResolved {
        if let message = input.errorMessage, !message.isEmpty {
            return WidgetEventFeedResolved(
                phase: .error(message),
                items: [],
                emptyMessage: input.emptyMessage,
                emptyIconSymbol: input.emptyIconSymbol
            )
        }
        if input.isLoading {
            return WidgetEventFeedResolved(
                phase: .loading,
                items: [],
                emptyMessage: input.emptyMessage,
                emptyIconSymbol: input.emptyIconSymbol
            )
        }
        let arranged = WidgetEventFeedArrange.arrange(
            input.items,
            compact: input.compact,
            maxItems: input.maxItems
        )
        if arranged.isEmpty {
            return WidgetEventFeedResolved(
                phase: .empty,
                items: [],
                emptyMessage: input.emptyMessage,
                emptyIconSymbol: input.emptyIconSymbol
            )
        }
        return WidgetEventFeedResolved(
            phase: .feed,
            items: arranged,
            emptyMessage: input.emptyMessage,
            emptyIconSymbol: input.emptyIconSymbol
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a `WidgetEventFeedSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the `connection` axis,
/// forwards the host drill-through handler (web row `href` `Link`), and auto-refreshes once when the
/// feed transitions to stale. No networking lives here — the items are owned upstream.
@MainActor
@Observable
public final class WidgetEventFeedModel {
    public private(set) var resolved: WidgetEventFeedResolved = .init(
        phase: .loading,
        items: [],
        emptyMessage: nil,
        emptyIconSymbol: nil
    )
    public private(set) var connection: WidgetEventFeedConnection = .live

    public var phase: WidgetEventFeedResolved.Phase {
        resolved.phase
    }

    /// Whether the host wired a drill-through handler (web row `href` navigation). Gates whether a row
    /// carrying an `href` becomes tappable.
    public let canSelect: Bool

    @ObservationIgnored private let source: any WidgetEventFeedSource
    @ObservationIgnored private let telemetry: any WidgetEventFeedTelemetry
    @ObservationIgnored private let onSelect: (@MainActor (WidgetEventFeedItem) -> Void)?
    @ObservationIgnored private var started = false

    public init(
        source: any WidgetEventFeedSource,
        telemetry: any WidgetEventFeedTelemetry = OSLogWidgetEventFeedTelemetry(),
        onSelect: (@MainActor (WidgetEventFeedItem) -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onSelect = onSelect
        canSelect = onSelect != nil
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WidgetEventFeed.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    /// Forwards a row activation to the host's drill-through handler — the native parity of following
    /// the web row's `href` `Link`. A no-op when the item carries no `href` or no handler was wired.
    public func select(_ item: WidgetEventFeedItem) {
        guard item.href != nil else { return }
        onSelect?(item)
    }

    private func apply(_ input: WidgetEventFeedInput) {
        resolved = WidgetEventFeedProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "WidgetEventFeed" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings. The empty-state copy reuses the web source's own key (`widget.noEvents`).
public enum WidgetEventFeedStrings {
    public static let table = "WidgetEventFeed"

    public static let string: WidgetEventFeedResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
