//
//  EndpointSidebar.Model.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  The binding seams the view talks to and nothing else:
//    • P1/S8 state-holder seam — `EndpointCatalogSource` + `EndpointSidebarModel`
//      (the production app wires a source over the KMP OpenAPI/admin state holder;
//       the view performs NO networking).
//    • P1/S11 telemetry seam — `view.opened` for surface slug "EndpointSidebar".
//    • P1/S10 i18n facade — `EndpointSidebarStrings` (web `t(key, default)`).
//    • Testable accessibility seam — `EndpointSidebarAccessibility`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (consent-gated and
/// redacted there), per the P1/S11 contract.
public protocol EndpointSidebarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogEndpointSidebarTelemetry: EndpointSidebarTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the endpoint catalogue, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum EndpointLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Catalogue freshness, mirroring `LiveConnectionState` (ADR-013): a fresh read,
/// a read older than the freshness window, or an offline cached read.
public enum EndpointConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EndpointCatalogSource`: the parsed
/// endpoint catalogue plus its load/connection status and the externally-owned
/// selection (the web `selected` prop). The model turns this into the projection.
public struct EndpointSidebarUpdate: Sendable, Equatable {
    public var status: EndpointLoadStatus
    public var connection: EndpointConnection
    public var endpoints: [ParsedEndpoint]
    public var selected: ParsedEndpoint?
    public var updatedAt: Date?

    public init(
        status: EndpointLoadStatus = .loading,
        connection: EndpointConnection = .live,
        endpoints: [ParsedEndpoint] = [],
        selected: ParsedEndpoint? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.endpoints = endpoints
        self.selected = selected
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<[ParsedEndpoint]>>`
/// fed by the OpenAPI parser the web `ApiPlaygroundPage` runs); previews and tests
/// use `InMemoryEndpointCatalogSource`. The view never talks to the network.
@MainActor
public protocol EndpointCatalogSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EndpointSidebarUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The sidebar's observable view-model. Subscribes to an `EndpointCatalogSource`,
/// owns the search text, recomputes the grouped projection via
/// `EndpointSidebarBuilder`, exposes a render `Phase` + freshness, and forwards
/// selections to the host (web `onSelect`).
@MainActor
@Observable
public final class EndpointSidebarModel {
    /// The mutually-exclusive render branches (web shell loading / empty / list).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: EndpointConnection = .live
    public private(set) var endpoints: [ParsedEndpoint] = []
    public private(set) var selected: ParsedEndpoint?
    public private(set) var updatedAt: Date?

    /// Web `const [search, setSearch] = useState('')` — owned here so the
    /// projection (and its tests) can be driven without rendering the view.
    public var search: String = ""

    @ObservationIgnored private let source: any EndpointCatalogSource
    @ObservationIgnored private let telemetry: any EndpointSidebarTelemetry
    @ObservationIgnored private let onSelect: (@MainActor (ParsedEndpoint) -> Void)?
    @ObservationIgnored private var started = false

    public init(
        source: any EndpointCatalogSource,
        telemetry: any EndpointSidebarTelemetry = OSLogEndpointSidebarTelemetry(),
        onSelect: (@MainActor (ParsedEndpoint) -> Void)? = nil
    ) {
        self.source = source
        self.telemetry = telemetry
        self.onSelect = onSelect
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The grouped projection the view renders (web `filtered` + `grouped`).
    public var projection: EndpointSidebarProjection {
        EndpointSidebarBuilder.project(endpoints: endpoints, query: search, selected: selected)
    }

    /// Whether a given endpoint is the current selection (web
    /// `selected?.path === ep.path && selected?.method === ep.method`).
    public func isSelected(_ endpoint: ParsedEndpoint) -> Bool {
        selected?.id == endpoint.id
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EndpointSidebarView.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached catalogue stays visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    /// Records the selection and forwards it to the host (web `onSelect(ep)`).
    public func select(_ endpoint: ParsedEndpoint) {
        selected = endpoint
        onSelect?(endpoint)
    }

    private func apply(_ update: EndpointSidebarUpdate) {
        connection = update.connection
        endpoints = update.endpoints
        if let incoming = update.selected { selected = incoming }
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(update.status, hasEndpoints: !update.endpoints.isEmpty)
    }

    /// Resolves the render phase. A known catalogue stays visible behind a
    /// refresh or an error (cached values), matching the web shell, which only
    /// shows the skeleton on the first load and the empty state with no data.
    static func resolvePhase(_ status: EndpointLoadStatus, hasEndpoints: Bool) -> Phase {
        switch status {
        case .loading:
            hasEndpoints ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasEndpoints ? .content : .empty
        case let .failed(message):
            hasEndpoints ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEndpointCatalogSource: EndpointCatalogSource {
    public var onUpdate: (@MainActor (EndpointSidebarUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EndpointSidebarUpdate?

    public init(initial: EndpointSidebarUpdate? = nil) {
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
    public func push(_ update: EndpointSidebarUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "EndpointSidebar" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum EndpointSidebarStrings {
    public static let table = "EndpointSidebar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}

// MARK: - Accessibility seam (testable)

/// Builds the VoiceOver strings for the sidebar rows/groups. Pure + public so the
/// a11y label content can be unit-tested without rendering the view.
public enum EndpointSidebarAccessibility {
    /// Row label: method + path, with the summary appended when present and the
    /// "Selected" suffix when this row is the current selection.
    public static func rowLabel(for endpoint: ParsedEndpoint, isSelected: Bool) -> String {
        var parts = [
            EndpointSidebarStrings.format(
                "playground.a11yEndpoint", "%@ %@", endpoint.method.token, endpoint.path
            )
        ]
        let summary = endpoint.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if !summary.isEmpty { parts.append(summary) }
        if isSelected {
            parts.append(EndpointSidebarStrings.string("playground.a11ySelected", "Selected"))
        }
        return parts.joined(separator: ". ")
    }

    /// Group header label: tag name + the endpoint count (web count chip).
    public static func groupLabel(tag: String, count: Int) -> String {
        EndpointSidebarStrings.format("playground.a11yGroup", "%@, %d endpoints", tag, count)
    }
}
