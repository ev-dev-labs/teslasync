//
//  SettingsSearch.Model.swift
//  TeslaSync — P4 feature view · 0215 · SettingsSearch (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  settings find-as-you-type box. The view binds through `SettingsSearchModel`; no networking lives in
//  the view. SwiftUI parity of features/settings/components/SettingsSearch.tsx.
//
//  The web box owns its own query (`useState`) and re-ranks the synchronous `getSettingsIndex(t)` on
//  every keystroke via two `useMemo`s (no debounce, no request); selecting a row `navigate`s to its
//  `href`. The native model owns that lifecycle: it holds the query, re-projects the bound index on each
//  keystroke, resolves the result phase + freshness, forwards a selection through `onNavigate`, and
//  emits `view.opened` once on first appearance.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core telemetry
/// (ADR-016), which is consent-gated and redacted there.
public protocol SettingsSearchTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened`. The slug
/// is a static, non-identifying constant logged verbatim; no payload is ever recorded.
public struct OSLogSettingsSearchTelemetry: SettingsSearchTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no hardcoded
/// literals. Keys live in the "SettingsSearch" table (the three keys the web component reads plus the
/// `search.entries.*` index keys and the native envelope keys), folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum SettingsSearchStrings {
    public static let table = "SettingsSearch"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> SettingsSearchCopy {
        SettingsSearchCopy(
            fieldLabel: string("settings.search.label", "Search settings"),
            settingRole: string("settingsSearch.settingRole", "Setting")
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 settings
/// store — building the same index the web `getSettingsIndex(t)` builds (resolved through the P1/S10
/// facade) and reporting its load / freshness. Previews + tests use `InMemorySettingsSearchSource`.
/// There is no `search(_:)` member: ranking is client-side (web re-ranks the in-memory index), so the
/// source only delivers the index and re-builds on `refresh()`.
@MainActor
public protocol SettingsSearchSource: AnyObject {
    var onUpdate: (@MainActor (SettingsSearchUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-builds the settings index (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Owns the field `query`, re-projects the bound index into ranked
/// matches on each keystroke (web synchronous `useMemo`), resolves a render `SettingsSearchPhase` +
/// freshness, forwards a selected setting's deep-link through `onNavigate` (web `navigate(entry.href)`),
/// and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SettingsSearchModel {
    public private(set) var query: String
    public private(set) var phase: SettingsSearchPhase = .loading
    public private(set) var connection: SettingsSearchConnection = .live
    public private(set) var projection: SettingsSearchProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SettingsSearchSource
    @ObservationIgnored private let telemetry: any SettingsSearchTelemetry
    @ObservationIgnored private let copy: SettingsSearchCopy
    @ObservationIgnored private let onNavigate: @MainActor (SettingsDestination) -> Void
    @ObservationIgnored private var latestStatus: SettingsSearchLoadStatus = .idle
    @ObservationIgnored private var latestEntries: [SettingsEntry] = []
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SettingsSearchSource,
        telemetry: any SettingsSearchTelemetry = OSLogSettingsSearchTelemetry(),
        copy: SettingsSearchCopy = SettingsSearchStrings.copy(),
        initialQuery: String = "",
        onNavigate: @escaping @MainActor (SettingsDestination) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        query = initialQuery
        self.onNavigate = onNavigate
        source.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// The field's VoiceOver label (web `settings.search.label`).
    public var fieldAccessibilityLabel: String {
        copy.fieldLabel
    }

    /// The total number of settings in the bound index (used by the idle hint).
    public var catalogCount: Int {
        latestEntries.count
    }

    /// Whether the box currently holds a non-blank query (web `query.length > 0` after trim).
    public var isSearching: Bool {
        SettingsSearchProjector.isSearching(query)
    }

    /// The spoken status of the result area for the current phase.
    public var resultsAccessibilitySummary: String {
        SettingsSearchAccessibility.resultsSummary(
            for: phase,
            count: projection.matches.count,
            localize: SettingsSearchStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SettingsSearchSurface.slug)
        source.start()
    }

    /// Stops observing the bound source.
    public func stop() {
        started = false
        source.stop()
    }

    /// Handles a keystroke: re-ranks the index synchronously (web `useMemo` recompute — no debounce, no
    /// request). The web box opens its dropdown on first input; the native result area is always present
    /// and switches to the idle hint when the query is blank.
    public func setQuery(_ newValue: String) {
        query = newValue
        recompute()
    }

    /// Clears the box (the field's clear affordance, and the web `commit` `setQuery('')`).
    public func clear() {
        setQuery("")
    }

    /// Selects a matched setting (web `commit(entry)`): clears the query, then forwards the entry's
    /// parsed deep-link destination to the host's `onNavigate` (web `navigate(entry.href)` + the
    /// `#anchor` scroll). The bound index is the source of truth for the href.
    public func commit(_ match: SettingsMatch) {
        guard let entry = latestEntries.first(where: { $0.id == match.id }) else { return }
        clear()
        onNavigate(SettingsDestination.from(href: entry.href))
    }

    /// Re-builds the index (web re-derives `getSettingsIndex`) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    /// A `Binding` over `query` the SwiftUI `TextField` writes through `setQuery`.
    public var queryBinding: Binding<String> {
        Binding(get: { [weak self] in self?.query ?? "" }, set: { [weak self] in self?.setQuery($0) })
    }

    private func apply(_ update: SettingsSearchUpdate) {
        latestStatus = update.status
        latestEntries = update.entries
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    private func recompute() {
        projection = SettingsSearchProjector.project(entries: latestEntries, query: query, copy: copy)
        phase = SettingsSearchProjector.resolvePhase(
            latestStatus,
            isSearching: SettingsSearchProjector.isSearching(query),
            hasMatches: projection.hasMatches
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a later
    /// stale episode re-triggers exactly once. Offline keeps the cached index and does not refetch.
    private func handleAutoRefresh(for connection: SettingsSearchConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`, counts
/// the lifecycle calls, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySettingsSearchSource: SettingsSearchSource {
    public var onUpdate: (@MainActor (SettingsSearchUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SettingsSearchUpdate?

    public init(initial: SettingsSearchUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SettingsSearchUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SettingsSearch {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SettingsSearchSurface.slug
    }
}
