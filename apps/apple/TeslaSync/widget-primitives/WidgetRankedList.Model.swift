//
//  WidgetRankedList.Model.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), the i18n facade (P1/S10), and the pure
//  projection for the WidgetRankedList primitive. The view binds through ``WidgetRankedListModel``; no
//  networking lives in the view. A source emits the coalesced inputs (the controlled `items` + the web
//  `maxItems` / `compact` / `showBars` / `emptyMessage` props, the data freshness, plus the parent's
//  loading / error lifecycle); the model derives the resolved view-state over them, exposes a render
//  `phase` + the `connection` axis, and auto-refreshes once when the data transitions to stale.
//
//  The web source renders exactly one copy string of its own — the empty leaf default
//  `emptyMessage = 'No data available'` (a default value, not a `t()` call). It is resolved here through
//  the P1/S10 facade with that English fallback, alongside the native a11y additions (the row's combined
//  rank/label/value reading + badge append) and the leaf-contract copy (loading / error / freshness), so
//  the Swift sources hold no hardcoded prose.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol WidgetRankedListTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogWidgetRankedListTelemetry: WidgetRankedListTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "WidgetRankedList" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The empty-leaf copy reuses the web source's own default literal.
public enum WidgetRankedListStrings {
    public static let table = "WidgetRankedList"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-leaf headline — the web `emptyMessage` default literal `"No data available"` (the
    /// surface's only own copy).
    public static var emptyMessage: String {
        string("widgetRankedList.empty", "No data available")
    }

    /// Supporting line of the empty leaf, so the surface never renders a bare box (native HIG; the web
    /// renders a single centered line).
    public static var emptyHint: String {
        string("widgetRankedList.emptyHint", "Items appear here once ranked data is available.")
    }

    /// The VoiceOver reading for the loading skeleton.
    public static var loadingAccessibility: String {
        string("widgetRankedList.loadingA11y", "Loading ranked items")
    }

    /// The error tile headline (web `QueryError` peer title).
    public static var errorTitle: String {
        string("widgetRankedList.errorTitle", "Couldn't load items")
    }

    /// The error tile retry affordance label.
    public static var retry: String {
        string("widgetRankedList.retry", "Retry")
    }

    /// Composes a row's combined VoiceOver reading — "Rank {rank}: {label}, {value}" — from the 1-based
    /// rank, the label, and the formatted value. A positional format so translators can reorder the parts.
    public static func rowAccessibilityLabel(rank: Int, label: String, value: String) -> String {
        let format = string("widgetRankedList.rowLabel", "Rank %1$d: %2$@, %3$@")
        return String(format: format, rank, label, value)
    }

    /// Appends a row's badge reading to its base label — "{base}, {badge}" — so VoiceOver reads the whole
    /// row as one element. A positional format so translators can reorder.
    public static func rowWithBadge(base: String, badge: String) -> String {
        let format = string("widgetRankedList.rowBadge", "%1$@, %2$@")
        return String(format: format, base, badge)
    }

    /// The freshness-chip label for a connectivity state (web has none; native P4 leaf copy).
    public static func freshnessLabel(_ connection: WidgetRankedListConnection) -> String {
        switch connection {
        case .live: string("widgetRankedList.live", "Live")
        case .stale: string("widgetRankedList.stale", "Stale")
        case .offline: string("widgetRankedList.offline", "Offline")
        }
    }

    /// The freshness-chip spoken reading for a connectivity state.
    public static func freshnessAccessibility(_ connection: WidgetRankedListConnection) -> String {
        switch connection {
        case .live:
            string("widgetRankedList.live", "Live")
        case .stale:
            string("widgetRankedList.staleA11y", "Stale — tap to refresh")
        case .offline:
            string("widgetRankedList.offlineA11y", "Offline — showing the last known items")
        }
    }
}

// MARK: - Input snapshot (controlled items + props + connectivity + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the controlled `items` and the web props (`maxItems`,
/// `compact`, `showBars`, the optional `emptyMessage` / `emptyIcon` overrides), the data freshness, plus
/// the parent's lifecycle (`isLoading`, an error message). The view-state is derived purely from this.
public struct WidgetRankedListInput: Sendable, Equatable {
    public var items: [RankedItem]
    public var maxItems: Int?
    public var compact: Bool
    public var showBars: Bool
    public var emptyMessage: String?
    public var emptyIconSymbol: String?
    public var connection: WidgetRankedListConnection
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        items: [RankedItem] = [],
        maxItems: Int? = nil,
        compact: Bool = false,
        showBars: Bool = true,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        connection: WidgetRankedListConnection = .live,
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.items = items
        self.maxItems = maxItems
        self.compact = compact
        self.showBars = showBars
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
        self.connection = connection
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body; for the `.list` phase the arranged `rows`
/// (sorted-desc + sliced + ranked + bar-scaled) are pre-computed so the view is a pure function of this
/// value. `hideBars` carries the web `compact || !showBars`; `emptyMessage` / `emptyIconSymbol` carry the
/// caller's verbatim overrides for the empty branch.
public struct WidgetRankedListResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case list
    }

    public let phase: Phase
    public let rows: [RankedListRow]
    public let hideBars: Bool
    public let emptyMessage: String?
    public let emptyIconSymbol: String?

    public init(
        phase: Phase,
        rows: [RankedListRow],
        hideBars: Bool,
        emptyMessage: String?,
        emptyIconSymbol: String?
    ) {
        self.phase = phase
        self.rows = rows
        self.hideBars = hideBars
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. The branch priority is: a data
/// failure (`error`) → the initial fetch (`loading`) → the arranged list (`list`, the web body) → the
/// friendly empty leaf (web `EmptyState`, never a blank box). The connectivity axis does not gate the list
/// — it surfaces as the freshness chip above it. Unit tested across every branch.
public enum WidgetRankedListProjection {
    public static func resolve(input: WidgetRankedListInput) -> WidgetRankedListResolved {
        let hideBars = WidgetRankedListArrange.hideBars(compact: input.compact, showBars: input.showBars)
        if let message = input.errorMessage, !message.isEmpty {
            return resolved(.error(message), rows: [], hideBars: hideBars, input: input)
        }
        if input.isLoading {
            return resolved(.loading, rows: [], hideBars: hideBars, input: input)
        }
        let rows = WidgetRankedListArrange.rows(input.items, compact: input.compact, maxItems: input.maxItems)
        if rows.isEmpty {
            return resolved(.empty, rows: [], hideBars: hideBars, input: input)
        }
        return resolved(.list, rows: rows, hideBars: hideBars, input: input)
    }

    private static func resolved(
        _ phase: WidgetRankedListResolved.Phase,
        rows: [RankedListRow],
        hideBars: Bool,
        input: WidgetRankedListInput
    ) -> WidgetRankedListResolved {
        WidgetRankedListResolved(
            phase: phase,
            rows: rows,
            hideBars: hideBars,
            emptyMessage: input.emptyMessage,
            emptyIconSymbol: input.emptyIconSymbol
        )
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Subscribes to a ``WidgetRankedListSource``, recomputes the resolved
/// projection, exposes a render `phase` + the resolved view-state and the `connection` axis, and
/// auto-refreshes once when the data transitions to stale. No networking lives here — the items are owned
/// upstream (the web component is fully controlled by its props).
@MainActor
@Observable
public final class WidgetRankedListModel {
    public private(set) var resolved: WidgetRankedListResolved = .init(
        phase: .loading,
        rows: [],
        hideBars: false,
        emptyMessage: nil,
        emptyIconSymbol: nil
    )
    public private(set) var connection: WidgetRankedListConnection = .live

    public var phase: WidgetRankedListResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any WidgetRankedListSource
    @ObservationIgnored private let telemetry: any WidgetRankedListTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WidgetRankedListSource,
        telemetry: any WidgetRankedListTelemetry = OSLogWidgetRankedListTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: WidgetRankedListSurface.slug)
        source.start()
    }

    /// Stops observing the upstream data. Re-arms the one-shot `view.opened` for the next `start`.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: WidgetRankedListInput) {
        resolved = WidgetRankedListProjection.resolve(input: input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}
