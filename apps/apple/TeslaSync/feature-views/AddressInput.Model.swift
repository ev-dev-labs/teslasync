//
//  AddressInput.Model.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  geocoded "Address" autocomplete. The view binds through `AddressInputModel`; no networking lives
//  in the view. SwiftUI parity of features/driving/components/AddressInput.tsx.
//
//  The web component is controlled by its parent (`value` / `onChange` / `onSelect`) and debounces
//  the typed value (400 ms) into `useGeocodeSearch`. The native model owns that whole lifecycle: it
//  debounces `query` into a `AddressInputSource` search, projects the rows, resolves the menu phase
//  + freshness, forwards the parent callbacks, and emits `view.opened` once.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol AddressInputTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAddressInputTelemetry: AddressInputTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "AddressInput" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum AddressInputStrings {
    public static let table = "AddressInput"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// SwiftUI `Text` from the catalog (the view holds no English literals).
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Resolves the projector's injected, pre-localized copy from the catalog.
    public static func copy() -> AddressInputCopy {
        AddressInputCopy(
            fieldLabel: string("addressInput.label", "Address"),
            suggestionRole: string("addressInput.suggestionRole", "Address suggestion")
        )
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `AddressInputSource`: the geocoder rows + their load status,
/// the live-state connection, the in-flight flag, and the last-update timestamp.
public struct AddressInputUpdate: Sendable, Equatable {
    public var status: AddressInputLoadStatus
    public var results: [GeocodeResultDTO]
    public var connection: AddressInputConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AddressInputLoadStatus = .idle,
        results: [GeocodeResultDTO] = [],
        connection: AddressInputConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.results = results
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — wiring `search(_:)` to the `useGeocodeSearch` query the web component reads. Previews +
/// tests use `InMemoryAddressInputSource`. The view never talks to the network directly.
@MainActor
public protocol AddressInputSource: AnyObject {
    var onUpdate: (@MainActor (AddressInputUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Runs the geocode search for the (debounced) query (web `useGeocodeSearch(debouncedQuery)`).
    func search(_ query: String)
    /// Re-runs the current query (the error-state retry / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Owns the field `query`, debounces it into the bound
/// `AddressInputSource` search, projects each snapshot into suggestion rows, resolves a render
/// `AddressSuggestionsPhase` + freshness, forwards the parent `onChange` / `onSelect` callbacks, and
/// emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class AddressInputModel {
    public private(set) var query: String
    public private(set) var phase: AddressSuggestionsPhase = .idle
    public private(set) var connection: AddressInputConnection = .live
    public private(set) var projection: AddressInputProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?
    /// The last confirmed selection (web filled input after choosing an option); `nil` while typing.
    public private(set) var selected: TripLocationDTO?

    @ObservationIgnored private let source: any AddressInputSource
    @ObservationIgnored private let telemetry: any AddressInputTelemetry
    @ObservationIgnored private let copy: AddressInputCopy
    @ObservationIgnored private let onChange: @MainActor (String) -> Void
    @ObservationIgnored private let onSelect: @MainActor (TripLocationDTO) -> Void
    @ObservationIgnored private let debounceInterval: TimeInterval
    @ObservationIgnored private var latestStatus: AddressInputLoadStatus = .idle
    @ObservationIgnored private var latestResults: [GeocodeResultDTO] = []
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AddressInputSource,
        telemetry: any AddressInputTelemetry = OSLogAddressInputTelemetry(),
        copy: AddressInputCopy = AddressInputStrings.copy(),
        initialQuery: String = "",
        debounceInterval: TimeInterval = AddressInputConfig.debounceInterval,
        onChange: @escaping @MainActor (String) -> Void = { _ in },
        onSelect: @escaping @MainActor (TripLocationDTO) -> Void = { _ in }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.copy = copy
        query = initialQuery
        self.debounceInterval = debounceInterval
        self.onChange = onChange
        self.onSelect = onSelect
        source.onUpdate = { [weak self] update in self?.apply(update) }
        recompute()
    }

    /// The field's accessibility label (web `t('addressInput.label', 'Address')`).
    public var fieldAccessibilityLabel: String {
        copy.fieldLabel
    }

    /// The spoken status of the suggestion area for the current phase.
    public var resultsAccessibilitySummary: String {
        AddressInputAccessibility.resultsSummary(
            for: phase,
            count: projection.suggestions.count,
            localize: AddressInputStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent. Triggers the
    /// initial search when seeded with a long-enough query (web mount → debounce → query).
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AddressInputSurface.slug)
        source.start()
        if AddressInputProjector.meetsMinimumLength(query) {
            scheduleSearch(query)
        }
    }

    /// Stops observing and cancels any pending debounced search.
    public func stop() {
        started = false
        searchTask?.cancel()
        searchTask = nil
        source.stop()
    }

    /// Handles a keystroke: forwards the raw text to the parent (web `onInputChange` + `onChange`),
    /// clears any prior confirmed selection, and debounces the geocode search.
    public func setQuery(_ newValue: String) {
        query = newValue
        if selected?.name != newValue { selected = nil }
        onChange(newValue)
        if AddressInputProjector.meetsMinimumLength(newValue) {
            scheduleSearch(newValue)
        } else {
            searchTask?.cancel()
            searchTask = nil
        }
        // Re-resolve the phase off the new query length on every keystroke: crossing the minimum
        // flips the idle hint to the searching state immediately (web keeps the prior options
        // visible during the 400 ms debounce, which the retained projection reproduces).
        recompute()
    }

    /// Confirms a suggestion: writes its address back (web `onChange(display_name)`), emits the
    /// coordinates (web `onSelect({ lat, lng, name })`), and collapses the live menu.
    public func select(_ suggestion: AddressSuggestion) {
        searchTask?.cancel()
        searchTask = nil
        query = suggestion.title
        selected = suggestion.location
        onChange(suggestion.title)
        onSelect(suggestion.location)
    }

    /// Re-runs the current query (web parent refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    /// A `Binding` over `query` the SwiftUI `TextField` writes through `setQuery`.
    public var queryBinding: Binding<String> {
        Binding(get: { [weak self] in self?.query ?? "" }, set: { [weak self] in self?.setQuery($0) })
    }

    private func scheduleSearch(_ value: String) {
        searchTask?.cancel()
        guard debounceInterval > 0 else {
            source.search(value)
            return
        }
        searchTask = Task { [weak self, debounceInterval] in
            try? await Task.sleep(for: .seconds(debounceInterval))
            guard !Task.isCancelled else { return }
            self?.source.search(value)
        }
    }

    private func apply(_ update: AddressInputUpdate) {
        latestStatus = update.status
        latestResults = update.results
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        recompute()
        handleAutoRefresh(for: update.connection)
    }

    private func recompute() {
        projection = AddressInputProjector.project(results: latestResults, copy: copy)
        phase = AddressInputProjector.resolvePhase(
            latestStatus,
            queryLength: query.count,
            hasResults: projection.hasSuggestions
        )
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached rows and does not
    /// refetch.
    private func handleAutoRefresh(for connection: AddressInputConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()`,
/// records the searched queries, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAddressInputSource: AddressInputSource {
    public var onUpdate: (@MainActor (AddressInputUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var searchedQueries: [String] = []

    private let initial: AddressInputUpdate?

    public init(initial: AddressInputUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func search(_ query: String) {
        searchedQueries.append(query)
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: AddressInputUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension AddressInput {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AddressInputSurface.slug
    }
}
