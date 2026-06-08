//
//  DataPipelineSection.Model.swift
//  TeslaSync — P4 feature view · 0242 · DataPipelineSection (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the dev-tools Data Pipeline surface. The view binds through
//  `DataPipelineModel`; no networking lives in the view. The web source
//  (DataPipelineSection.tsx) issues two polling `useQuery`s — compression stats
//  (30s) and the export-job queue (15s) — so the input snapshot here carries both
//  resolved results plus the parent's loading / error / connectivity state rather
//  than issuing HTTP itself (the production app wires the source to the dev-tools
//  client; previews/tests use `InMemoryDataPipelineSource`).
//
//  States: the web branches are `isLoading` (two skeletons), the optional compression
//  block, and the export-queue table-or-empty render. On top of those, this surface
//  honours the P4 leaf contract: a render `phase` (loading / ready / error) fed by the
//  query state, and an orthogonal `connection` axis (live / stale / offline) surfaced
//  as a freshness chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol DataPipelineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogDataPipelineTelemetry: DataPipelineTelemetry {
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
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it (the web
/// queries poll continuously; this is the native-idiomatic surfacing of feed health).
public enum DataPipelineConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web `useQuery` results + parent lifecycle)

/// One coalesced snapshot of the panel's inputs — the native mirror of the two web
/// query results (`compression`, `exportJobs`) plus the parent surface's lifecycle
/// (`isLoading`, an error message, and connectivity). `jobs == nil` is "not yet
/// loaded"; `jobs == []` is "loaded, queue empty" (the web `DataTable` empty render).
public struct DataPipelineInput: Sendable, Equatable {
    public var compression: CompressionSnapshot?
    public var jobs: [ExportJobItem]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: DataPipelineConnection

    public init(
        compression: CompressionSnapshot? = nil,
        jobs: [ExportJobItem]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: DataPipelineConnection = .live
    ) {
        self.compression = compression
        self.jobs = jobs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; the compression snapshot, the (possibly empty) job list,
/// the status counts, and the gauge fraction are pre-computed so the view is a pure
/// function of this value.
public struct DataPipelineResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case ready
    }

    public let phase: Phase
    public let compression: CompressionSnapshot?
    public let jobs: [ExportJobItem]
    public let counts: DataPipelineCounts

    public init(
        phase: Phase,
        compression: CompressionSnapshot?,
        jobs: [ExportJobItem],
        counts: DataPipelineCounts
    ) {
        self.phase = phase
        self.compression = compression
        self.jobs = jobs
        self.counts = counts
    }

    /// Whether the compression block has data (web `{compression && …}`). The section
    /// is always rendered; this flag selects its content vs. its empty state.
    public var hasCompression: Bool {
        compression != nil
    }

    /// Whether the queue has any rows (web `exportJobs && exportJobs.length > 0`).
    public var hasJobs: Bool {
        !jobs.isEmpty
    }

    /// The savings percentage as a clamped 0…1 fraction for the radial gauge (web
    /// `<RadialGauge value={savings_percent} max={100} />`).
    public var savingsFraction: Double {
        guard let percent = compression?.savingsPercent, percent.isFinite else { return 0 }
        return min(max(percent / 100, 0), 1)
    }

    /// Whether the header savings badge shows (web compression-present badge).
    public var showSavingsBadge: Bool {
        hasCompression
    }

    /// Whether the header "N active" badge shows (web `pendingJobs + processingJobs > 0`).
    public var showActiveBadge: Bool {
        counts.active > 0
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit tested
/// across loading / error / ready and the count derivation.
public enum DataPipelineProjection {
    public static func resolve(_ input: DataPipelineInput) -> DataPipelineResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return DataPipelineResolved(
                phase: .error(message),
                compression: nil,
                jobs: [],
                counts: DataPipelineCounts()
            )
        }
        // Web `isLoading = compLoading || exportLoading` → the two-skeleton chrome.
        if input.isLoading {
            return DataPipelineResolved(phase: .loading, compression: nil, jobs: [], counts: DataPipelineCounts())
        }
        let jobs = input.jobs ?? []
        return DataPipelineResolved(
            phase: .ready,
            compression: input.compression,
            jobs: jobs,
            counts: DataPipelineCounts.tally(jobs)
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// dev-tools compression + export-job queries; previews and tests use
/// `InMemoryDataPipelineSource`. The view never talks to the network directly.
@MainActor
public protocol DataPipelineSource: AnyObject {
    var onUpdate: (@MainActor (DataPipelineInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `DataPipelineSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class DataPipelineModel {
    public private(set) var resolved: DataPipelineResolved =
        DataPipelineProjection.resolve(DataPipelineInput(isLoading: true))
    public private(set) var connection: DataPipelineConnection = .live

    public var phase: DataPipelineResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any DataPipelineSource
    @ObservationIgnored private let telemetry: any DataPipelineTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DataPipelineSource,
        telemetry: any DataPipelineTelemetry = OSLogDataPipelineTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DataPipelineSection.surfaceSlug)
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

    private func apply(_ input: DataPipelineInput) {
        resolved = DataPipelineProjection.resolve(input)
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
public final class InMemoryDataPipelineSource: DataPipelineSource {
    public var onUpdate: (@MainActor (DataPipelineInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DataPipelineInput?

    public init(initial: DataPipelineInput? = nil) {
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
    public func push(_ input: DataPipelineInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "DataPipelineSection" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum DataPipelineStrings {
    public static let table = "DataPipelineSection"

    /// Resolved `String` for a key (web `t(key, fallback)`). The `LocalizedStringKey`
    /// convenience for shared components lives in `DataPipelineSection.Views.swift`
    /// (the SwiftUI layer) so this state-holder file stays SwiftUI-free.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
