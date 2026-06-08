//
//  ClientUtilitiesSection.Model.swift
//  TeslaSync — P4 feature view · 0003 · ClientUtilitiesSection (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the tool
//  catalog (no networking in the view), the P1/S11 telemetry contract, the P1/S10
//  i18n facade, and the `@Observable` view-model that owns the search text +
//  single-open accordion selection and resolves the render phase. Previews/tests
//  drive the model with `InMemoryToolCatalogSource`; production wires a source over
//  the shared catalog state holder.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol ClientUtilitiesTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogClientUtilitiesTelemetry: ClientUtilitiesTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the catalog, mirroring the shared `LoadableState` cases
/// the production source projects from the catalog `Resource<T>`.
public enum ToolCatalogStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). The catalog is
/// static client-side data, but the seam still carries freshness so a remote-gated
/// catalog (feature flags / entitlements) renders the stale/offline chrome.
public enum ClientUtilitiesConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ToolCatalogSource`: the resolved tool list
/// plus its load/connection status. The model turns this into the render phase.
public struct ToolCatalogUpdate: Sendable, Equatable {
    public var status: ToolCatalogStatus
    public var connection: ClientUtilitiesConnection
    public var tools: [ToolDescriptor]
    public var updatedAt: Date?

    public init(
        status: ToolCatalogStatus = .loading,
        connection: ClientUtilitiesConnection = .live,
        tools: [ToolDescriptor] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.tools = tools
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared
/// P1/S8 catalog state holder; previews/tests use `InMemoryToolCatalogSource`. The
/// view never talks to the network directly.
@MainActor
public protocol ToolCatalogSource: AnyObject {
    var onUpdate: (@MainActor (ToolCatalogUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `ToolCatalogSource`, owns
/// the search query + single-open accordion selection, recomputes the filtered
/// projection, and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ClientUtilitiesModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ClientUtilitiesConnection = .live
    public private(set) var tools: [ToolDescriptor] = []
    public private(set) var updatedAt: Date?

    /// The live search query (web `search`). Mutated by the search field.
    public var searchText: String = ""
    /// The currently expanded tool id, or `nil` (web `expandedId`).
    public private(set) var expandedID: String?

    @ObservationIgnored private let source: any ToolCatalogSource
    @ObservationIgnored private let telemetry: any ClientUtilitiesTelemetry
    @ObservationIgnored private let localize: (String, String) -> String
    @ObservationIgnored private var started = false

    public init(
        source: any ToolCatalogSource,
        telemetry: any ClientUtilitiesTelemetry = OSLogClientUtilitiesTelemetry(),
        localize: @escaping (String, String) -> String = ClientUtilitiesStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The filtered tool list (web `filtered`), recomputed from the current query.
    public var filteredTools: [ToolDescriptor] {
        ToolFilter.filter(tools, query: searchText, localize: localize)
    }

    /// Whether the content state has tools but the active search excludes them all
    /// (web `filtered.length === 0`). False while the catalog itself is empty.
    public var isSearchEmpty: Bool {
        phase == .content && filteredTools.isEmpty
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ClientUtilitiesSection.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream catalog feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a catalog refresh (cached tools stay visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    /// Updates the live search query (web `setSearch`).
    public func setSearch(_ text: String) {
        searchText = text
    }

    /// Toggles a tool's disclosure with single-open semantics (web `onToggle`).
    public func toggle(_ id: String) {
        expandedID = ToolDisclosure.toggled(current: expandedID, selecting: id)
    }

    private func apply(_ update: ToolCatalogUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        tools = update.tools
        phase = Self.resolvePhase(update)
        if let expandedID, !update.tools.contains(where: { $0.id == expandedID }) {
            self.expandedID = nil
        }
    }

    /// Resolves the render phase. The catalog renders whenever tools are known
    /// (cached tools stay visible behind a refresh/error, freshness reflected by
    /// the chip); the skeleton shows only on the initial fetch and the catalog-empty
    /// state only when the resolved catalog has no tools at all.
    public static func resolvePhase(_ update: ToolCatalogUpdate) -> Phase {
        let hasTools = !update.tools.isEmpty
        switch update.status {
        case .loading:
            return hasTools ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasTools ? .content : .empty
        case let .failed(message):
            return hasTools ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryToolCatalogSource: ToolCatalogSource {
    public var onUpdate: (@MainActor (ToolCatalogUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ToolCatalogUpdate?

    public init(initial: ToolCatalogUpdate? = nil) {
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
    public func push(_ update: ToolCatalogUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ClientUtilitiesSection"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time;
/// kept per-surface so each parallel prompt owns its own strings without editing
/// the shared catalog.
public enum ClientUtilitiesStrings {
    public static let table = "ClientUtilitiesSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
