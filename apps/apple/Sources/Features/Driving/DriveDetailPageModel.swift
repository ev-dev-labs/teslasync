import Foundation
import Observation

// MARK: - Data source seam (web `useDrive` + `useVehicle` + `useDriveWhyEnded`)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error states. Mirrors the sibling `*DataSource`
/// seams.
///
/// Method ↔ web map: `loadDrive` ← `useDrive(id)` / `GET /drives/{id}`; `loadVehicle` ←
/// `useVehicle(vehicleId)` / `GET /vehicles/{id}`; `loadWhyEnded` ← `useDriveWhyEnded(id,
/// window, enabled)` / `GET /drives/{id}/why-ended?window=…`.
public protocol DriveDetailDataSource: Sendable {
    func loadDrive(driveID: Int64) async throws -> DriveDetailRecord
    func loadVehicle(vehicleID: Int64) async throws -> DriveDetailVehicle?
    func loadWhyEnded(driveID: Int64, window: DriveDetailDiagnosticWindow) async throws -> DriveWhyEnded
}

// MARK: - Why-ended sub-phase (web lazy `useDriveWhyEnded` query state)

/// The lazy why-ended panel's own phase (web `isLoading` / `error` / data). It is independent
/// of the page phase because the web query only fires when the panel is expanded.
public enum DriveWhyEndedPhase: Equatable, Sendable {
    case idle
    case loading
    case ready
    case error(String)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the drive, its owning vehicle, and the lazily-loaded why-ended diagnostic. The drive
/// fetch resolves the page phase (web `isLoading ? Skeleton : error ? error : body`); the
/// vehicle query is best-effort and never blocks the page, exactly as the web's independent
/// hooks behave. The chart samples + aggregate `stats` are derived once from the drive so the
/// sections read them without recomputing.
@MainActor
@Observable
public final class DriveDetailPageModel {
    /// The drive id this page details (web route `:id`).
    public let driveID: Int64

    public private(set) var phase: DriveDetailPhase = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var record: DriveDetailRecord?
    public private(set) var vehicle: DriveDetailVehicle?

    /// Web lazy why-ended panel state.
    public var whyEndedExpanded = false
    public var whyEndedWindow: DriveDetailDiagnosticWindow = .s60
    public private(set) var whyEndedPhase: DriveWhyEndedPhase = .idle
    public private(set) var whyEnded: DriveWhyEnded?

    /// Sections whose render failed — fronts each web `SectionErrorBoundary`. Empty in normal
    /// operation; the preview/test seams inject ids to exercise the localized fallback titles.
    public var failedSections: Set<DriveDetailSectionID> = []

    @ObservationIgnored private let dataSource: any DriveDetailDataSource

    public init(
        driveID: Int64,
        dataSource: any DriveDetailDataSource = SampleDriveDetailDataSource()
    ) {
        self.driveID = driveID
        self.dataSource = dataSource
    }

    // MARK: Derived (web `useDriveDetailData` memos)

    /// Web chart/stat source (telemetry if present, else positions).
    public var chartSamples: [DriveTelemetrySample] {
        guard let record else { return [] }
        return DriveDetailDerivations.chartSamples(record)
    }

    /// Web `stats` memo (SI), or `nil` until the drive resolves.
    public var stats: DriveStats? {
        guard let record else { return nil }
        return DriveDetailDerivations.stats(record, samples: chartSamples)
    }

    /// Web route coordinates (valid, non-null-island).
    public var routeCoordinates: [DriveRouteCoordinate] {
        guard let record else { return [] }
        return DriveDetailDerivations.routeCoordinates(record)
    }

    /// Web `hasMeaningfulDriveStats` envelope gate (banner vs. numeric panels).
    public var hasMeaningfulDriveStats: Bool {
        guard let record, let stats else { return false }
        return DriveDetailDerivations.hasMeaningfulDriveStats(record, stats)
    }

    /// Whether a section should render its localized failure fallback (web boundary caught).
    public func isFailed(_ section: DriveDetailSectionID) -> Bool {
        failedSections.contains(section)
    }

    // MARK: Loading

    /// Loads the drive then its vehicle (web `useDrive` + `useVehicle`). A drive-fetch failure
    /// surfaces the retryable error region; the vehicle degrades to its label fallback.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        do {
            let loaded = try await dataSource.loadDrive(driveID: driveID)
            record = loaded
            vehicle = try? await dataSource.loadVehicle(vehicleID: loaded.vehicleID)
            phase = .ready
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Why-ended (web lazy panel)

    /// Web expand toggle: expanding fires the query the first time; collapsing keeps the data.
    public func toggleWhyEnded() async {
        whyEndedExpanded.toggle()
        if whyEndedExpanded, whyEndedPhase == .idle {
            await loadWhyEnded()
        }
    }

    /// Web window `<Select>` change: re-runs the query while expanded.
    public func selectWhyEndedWindow(_ window: DriveDetailDiagnosticWindow) async {
        guard window != whyEndedWindow else { return }
        whyEndedWindow = window
        if whyEndedExpanded {
            await loadWhyEnded()
        }
    }

    /// Loads the why-ended diagnostic for the current window (web `useDriveWhyEnded`).
    public func loadWhyEnded() async {
        whyEndedPhase = .loading
        do {
            whyEnded = try await dataSource.loadWhyEnded(driveID: driveID, window: whyEndedWindow)
            whyEndedPhase = .ready
        } catch {
            whyEndedPhase = .error(error.localizedDescription)
        }
    }
}
