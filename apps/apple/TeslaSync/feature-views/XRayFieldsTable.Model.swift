//
//  XRayFieldsTable.Model.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) + surface
//  slug for the XRayFieldsTable feature view. Vendor-agnostic and SwiftUI-free so the
//  model/sort/projection logic compiles and runs on a plain host (the surface view layers
//  SwiftUI chrome on top in XRayFieldsTable.swift).
//
//  Parity target: web/src/features/admin/components/ingest-xray/XRayFieldsTable.tsx —
//  a sortable per-field ingest-statistics table. The web component receives `rows` + `loading`
//  from the page; the native feature view binds the `useIngestXRay` query directly through this
//  P1/S8 seam, so it owns the full query lifecycle (loading / empty / error / stale / offline /
//  content) plus the `useSortToggle('sample_count', 'desc')` sort state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted there).
public protocol XRayFieldsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to
/// the shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogXRayFieldsTelemetry: XRayFieldsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Domain model (mirrors IngestXRayFieldStat)

/// One per-field ingest statistic, mirroring the web `IngestXRayFieldStat` DTO
/// (`field`, `sample_count`, `last_seen_at`, `value_kind`). `lastSeenAt` is kept as the raw
/// ISO-8601 string exactly as the API delivers it so the relative-time projection matches the
/// web `<TimeStamp format="relative">` byte-for-byte.
public struct XRayFieldStat: Sendable, Equatable, Identifiable {
    public var field: String
    public var sampleCount: Int
    public var lastSeenAt: String
    public var valueKind: Int

    public var id: String {
        field
    }

    public init(field: String, sampleCount: Int, lastSeenAt: String, valueKind: Int) {
        self.field = field
        self.sampleCount = sampleCount
        self.lastSeenAt = lastSeenAt
        self.valueKind = valueKind
    }
}

/// The sortable column, mirroring the web `sortKey` switch (`field` / `sample_count` /
/// `last_seen_at` / `value_kind`). Raw values match the web column keys for 1:1 parity.
public enum XRayFieldsSortKey: String, Sendable, CaseIterable {
    case field
    case sampleCount = "sample_count"
    case lastSeenAt = "last_seen_at"
    case valueKind = "value_kind"
}

/// Sort direction, mirroring the web `'asc' | 'desc'`.
public enum XRaySortDirection: String, Sendable, Equatable {
    case ascending = "asc"
    case descending = "desc"
}

/// The load lifecycle for the X-Ray query, mirroring the `Resource<IngestXRayResponse>` the
/// production source projects from `useIngestXRay`.
public enum XRayFieldsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query (ADR-013 `LiveConnectionState`), surfaced by the web
/// `useIngestXRay` `isFetching` / staleness through the native freshness chip + auto-refresh.
public enum XRayFieldsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `XRayFieldsSource`: the cached field rows plus the
/// load/connection status. The model turns this into the render phase + sorted projection.
public struct XRayFieldsUpdate: Sendable, Equatable {
    public var status: XRayFieldsLoadStatus
    public var connection: XRayFieldsConnection
    public var isFetching: Bool
    public var rows: [XRayFieldStat]?
    public var updatedAt: Date?

    public init(
        status: XRayFieldsLoadStatus = .loading,
        connection: XRayFieldsConnection = .live,
        isFetching: Bool = false,
        rows: [XRayFieldStat]? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.rows = rows
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (a `StateHolderModel<Resource<IngestXRayResponse>>` from the KMP X-Ray store);
/// previews and tests use `InMemoryXRayFieldsSource`. The view never talks to the network.
@MainActor
public protocol XRayFieldsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (XRayFieldsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The feature view's observable view-model. Subscribes to an `XRayFieldsSource`, exposes the
/// cached field rows + a render `Phase` + freshness + the `useSortToggle` sort state for SwiftUI
/// to switch over. The display projection (sort + per-cell formatting) is computed by the view
/// via `XRayFieldsProjector`, mirroring the web `const sorted = [...rows].sort(...)` derive.
@MainActor
@Observable
public final class XRayFieldsModel {
    /// The mutually-exclusive render branches (web `loading` → skeleton, empty message, rows).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: XRayFieldsConnection = .live
    public private(set) var isFetching = false
    public private(set) var rows: [XRayFieldStat] = []
    public private(set) var sortKey: XRayFieldsSortKey
    public private(set) var sortDirection: XRaySortDirection
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any XRayFieldsSource
    @ObservationIgnored private let telemetry: any XRayFieldsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any XRayFieldsSource,
        telemetry: any XRayFieldsTelemetry = OSLogXRayFieldsTelemetry(),
        defaultSortKey: XRayFieldsSortKey = .sampleCount,
        defaultSortDirection: XRaySortDirection = .descending
    ) {
        self.source = source
        self.telemetry = telemetry
        sortKey = defaultSortKey
        sortDirection = defaultSortDirection
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: XRayFieldsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refetch (cached rows stay visible). Wired to the retry / refresh affordances and
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web self-refresh on stale `useIngestXRay` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    /// Toggles the sort, reproducing the web `useSortToggle.onSort` exactly: tapping the active
    /// column flips the direction; tapping a new column selects it descending.
    public func toggleSort(_ key: XRayFieldsSortKey) {
        let next = Self.nextSort(current: sortKey, direction: sortDirection, tapped: key)
        sortKey = next.key
        sortDirection = next.direction
    }

    /// Pure `useSortToggle.onSort` transition (same column → flip; new column → descending).
    ///
    /// `nonisolated` because it is pure; this lets the sort-toggle parity be unit-tested from a
    /// non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func nextSort(
        current: XRayFieldsSortKey,
        direction: XRaySortDirection,
        tapped: XRayFieldsSortKey
    ) -> (key: XRayFieldsSortKey, direction: XRaySortDirection) {
        if tapped == current {
            return (current, direction == .ascending ? .descending : .ascending)
        }
        return (tapped, .descending)
    }

    private func apply(_ update: XRayFieldsUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        rows = update.rows ?? []
        phase = Self.resolvePhase(status: update.status, hasRows: !(update.rows ?? []).isEmpty)
    }

    /// Resolves the render phase. Mirroring the web component: the skeleton shows on the initial
    /// fetch and the empty message when there are no rows; whenever rows are known the table
    /// renders (cached rows stay visible behind a transient failure / offline pod so the operator
    /// still sees the last-known field statistics).
    ///
    /// `nonisolated` because it is pure (touches no actor state).
    public nonisolated static func resolvePhase(status: XRayFieldsLoadStatus, hasRows: Bool) -> Phase {
        switch status {
        case .loading:
            hasRows ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasRows ? .content : .empty
        case let .failed(message):
            hasRows ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryXRayFieldsSource: XRayFieldsSource {
    public var onUpdate: (@MainActor (XRayFieldsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: XRayFieldsUpdate?

    public init(initial: XRayFieldsUpdate? = nil) {
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
    public func push(_ update: XRayFieldsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// Diagnostics slug for this feature view, kept out of the SwiftUI view so the model/adapter
/// compile and test without SwiftUI. `XRayFieldsTable` re-exposes it as `surfaceSlug`.
public enum XRayFieldsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "XRayFieldsTable"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "XRayFieldsTable" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility text can use it; the SwiftUI helpers live in the view file.
public enum XRayFieldsStrings {
    public static let table = "XRayFieldsTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}
