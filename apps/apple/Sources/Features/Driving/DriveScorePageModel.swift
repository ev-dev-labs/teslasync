import Foundation
import Observation

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity + label strings,
/// not SI measurements, so they round-trip verbatim.
public struct DriveScoreVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String
    public let vin: String

    public init(id: Int64, displayName: String, vin: String) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
    }

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    public var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Data source seam (web hooks: useSelectedVehicle / useDriveScore / useDrives)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`; `useDriveScore` ← `GET /drives/score`;
/// `useDrives` ← `GET /drives?vehicle_id`.
public protocol DriveScoreDataSource: Sendable {
    func loadVehicles() async throws -> [DriveScoreVehicle]
    func useDriveScore(vehicleID: Int64) async throws -> DriveScoreSummary?
    func useDrives(vehicleID: Int64) async throws -> [DriveScoreDrive]
}

// MARK: - Page phase (web `isLoading ? Skeleton : scoredDrives.length === 0 ? EmptyState : content`)

/// The page's terminal phase. `.empty` is a successful load whose date-filtered scored set is empty
/// (web `scoredDrives.length === 0` guard — the "No Scored Drives" + "No data" empties); `.error` is
/// a retryable drives-load failure (web `PageContainer error` region); `.ready` carries drives.
public enum DriveScorePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Drives per page (web `DRIVES_PER_PAGE`)

private let drivesPerPage = 10

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection (web `useSelectedVehicle`), the date-range filter (web `RangePicker`),
/// the table sort + pagination (web `sortField` / `sortDir` / `currentPage`), the backend score
/// (web `useDriveScore`) and the drives list (web `useDrives`), and derives every panel/chart value
/// through `DriveScoreEngine`. Reads everything through the injected `DriveScoreDataSource`.
@MainActor
@Observable
public final class DriveScorePageModel {
    /// The drives-load state (web TanStack `isLoading` / `error` / success for `useDrives`).
    public enum LoadState: Equatable, Sendable {
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [DriveScoreVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    /// Web `useDriveScore` result — overrides the local averages when present.
    public private(set) var summary: DriveScoreSummary?
    /// Web `useDrives` result — the unfiltered drive list for the selected vehicle.
    public private(set) var drives: [DriveScoreDrive] = []

    // Date filter (web `startDate` / `endDate`, default last 30 days).
    public private(set) var startDate: Date
    public private(set) var endDate: Date

    // Table sort + pagination (web `sortField` / `sortDir` / `currentPage`).
    public private(set) var sortField: DriveSortField = .date
    public private(set) var sortDirection: DriveSortDirection = .descending
    public private(set) var currentPage = 0

    @ObservationIgnored private let dataSource: any DriveScoreDataSource
    @ObservationIgnored private let referenceDate: Date?

    public init(
        dataSource: any DriveScoreDataSource = SampleDriveScoreDataSource(),
        referenceDate: Date? = nil
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
        let clock = referenceDate ?? Date()
        endDate = clock
        startDate = Calendar.current.date(byAdding: .day, value: -30, to: clock) ?? clock
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer` phases): loading/error from the drives source, then
    /// empty when the date-filtered scored set is empty (web `scoredDrives.length === 0`), else ready.
    public var phase: DriveScorePhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: scoredDrives.isEmpty ? .empty : .ready
        }
    }

    // MARK: Selection

    public var selectedVehicle: DriveScoreVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's drives + score (web `useVehicles` +
    /// `useDrives` + `useDriveScore`).
    public func load() async {
        loadState = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSelectedVehicle()
    }

    /// Selects a vehicle (web global `VehicleSelect`) and reloads its drives + score, resetting the
    /// page (web `useEffect(..., [vehicleId])` → `setCurrentPage(1)`).
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        currentPage = 0
        loadState = .loading
        await loadSelectedVehicle()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            drives = []
            summary = nil
            loadState = .loaded
            return
        }
        // The drives list is the primary source (web `useDrives`): throw → error region.
        do {
            drives = try await dataSource.useDrives(vehicleID: id)
            loadState = .loaded
        } catch {
            drives = []
            loadState = .failed(error.localizedDescription)
        }
        // The backend score is secondary (web `useDriveScore`, `retry: false`): degrades to nil and
        // the page falls back to the locally-averaged scores.
        summary = try? await dataSource.useDriveScore(vehicleID: id)
    }

    // MARK: Filters (web `RangePicker` / `handleSort` / `setCurrentPage`)

    /// Applies a new date range and resets pagination (web `RangePicker.onChange` + `handleDateApply`).
    public func setDateRange(start: Date, end: Date) {
        startDate = start
        endDate = end
        currentPage = 0
    }

    /// Web `handleSort`: toggles direction on the active field, else switches field and defaults to
    /// descending; always resets to the first page.
    public func sort(by field: DriveSortField) {
        if sortField == field {
            sortDirection = sortDirection.toggled
        } else {
            sortField = field
            sortDirection = .descending
        }
        currentPage = 0
    }

    /// Clamps + sets the current (zero-based) page (web `setCurrentPage`).
    public func goToPage(_ index: Int) {
        currentPage = min(max(index, 0), max(totalPages - 1, 0))
    }

    // MARK: Derivations (web useMemo blocks, via `DriveScoreEngine`)

    /// Web `filteredDrives`: drives whose start falls within `[startDate, endDate + 1 day)`.
    public var filteredDrives: [DriveScoreDrive] {
        let calendar = Calendar.current
        let lowerBound = calendar.startOfDay(for: startDate)
        let upperDay = calendar.startOfDay(for: endDate)
        let upperBound = calendar.date(byAdding: .day, value: 1, to: upperDay) ?? upperDay
        return drives.filter { $0.startTs >= lowerBound && $0.startTs < upperBound }
    }

    /// Web `scoredDrives`: each filtered drive paired with its computed score.
    public var scoredDrives: [ScoredDrive] {
        DriveScoreEngine.scoredDrives(filteredDrives)
    }

    /// Web `sortedDrives`: the scored drives ordered by the active field + direction (stable).
    public var sortedDrives: [ScoredDrive] {
        let ascending = sortDirection == .ascending
        return scoredDrives.enumerated().sorted { lhs, rhs in
            let comparison = compare(lhs.element, rhs.element)
            if comparison == .orderedSame { return lhs.offset < rhs.offset }
            return ascending ? comparison == .orderedAscending : comparison == .orderedDescending
        }.map(\.element)
    }

    /// Web `totalPages = max(1, ceil(sortedDrives.length / DRIVES_PER_PAGE))`.
    public var totalPages: Int {
        max(1, Int((Double(sortedDrives.count) / Double(drivesPerPage)).rounded(.up)))
    }

    /// Web `paginatedDrives`: the current page's slice of the sorted drives.
    public var paginatedDrives: [ScoredDrive] {
        let start = currentPage * drivesPerPage
        guard start < sortedDrives.count else { return [] }
        let end = min(start + drivesPerPage, sortedDrives.count)
        return Array(sortedDrives[start ..< end])
    }

    /// Web `avgScores`.
    public var averages: DriveScoreAverages {
        DriveScoreEngine.averages(scoredDrives)
    }

    /// Web `overallScore = apiScore?.overall ?? avgScores.total`.
    public var overallScore: Int {
        summary?.overall ?? averages.total
    }

    /// Web `overallGrade = apiScore?.grade ?? gradeFromScore(overallScore)`.
    public var overallGrade: DriveGrade {
        if let raw = summary?.grade {
            return DriveGrade.parse(raw, score: overallScore)
        }
        return DriveGrade.from(score: overallScore)
    }

    /// Web `overallTrend = apiScore?.trend ?? 'flat'`.
    public var overallTrend: DriveScoreTrend {
        summary?.trend ?? .flat
    }

    /// The category score using the backend value when present else the local average (web pattern
    /// `apiScore?.x ?? avgScores.x`).
    public func categoryScore(_ category: DriveScoreCategory) -> Int {
        summary?.score(for: category) ?? averages.score(for: category)
    }

    /// Web `trendChartData`.
    public var trendPoints: [DriveScoreTrendPoint] {
        DriveScoreEngine.trendPoints(scoredDrives)
    }

    /// Web `categoryBarData`.
    public var categoryBars: [DriveScoreCategoryBar] {
        DriveScoreEngine.categoryBars(summary: summary, averages: averages)
    }

    /// Web `histogramData`.
    public var histogram: [DriveScoreHistogramBin] {
        DriveScoreEngine.histogram(scoredDrives)
    }

    /// Web `weakestCategory`.
    public var weakestCategory: DriveScoreCategory {
        DriveScoreEngine.weakestCategory(summary: summary, averages: averages)
    }

    /// Web `relevantTips`.
    public var relevantTips: [DriveScoreTip] {
        DriveScoreEngine.tips(for: weakestCategory)
    }

    /// Web `unlockedAchievements`.
    public var achievements: [DriveScoreAchievement] {
        DriveScoreEngine.achievements(scored: scoredDrives, driveCount: filteredDrives.count)
    }

    /// Web `bestDrive`.
    public var bestDrive: ScoredDrive? {
        DriveScoreEngine.bestDrive(scoredDrives)
    }

    /// Web `worstDrive`.
    public var worstDrive: ScoredDrive? {
        DriveScoreEngine.worstDrive(scoredDrives)
    }

    /// Web `periodStats`.
    public var periodStats: DriveScorePeriodStats? {
        DriveScoreEngine.periodStats(scoredDrives, now: referenceDate ?? Date())
    }

    /// Web `allScores.length > 0 ? max(...) : 0` — the single best total (Best Score stat card).
    public var bestScore: Int {
        scoredDrives.map(\.score.total).max() ?? 0
    }

    /// Web `allScores.filter(s => s.grade === 'A+').length` — the A+ count (Period Statistics KVList).
    public var aPlusCount: Int {
        scoredDrives.count(where: { $0.score.grade == .aPlus })
    }

    /// Web `filteredDrives.reduce(sum distanceM)` — total SI meters across the period.
    public var totalDistanceM: Double {
        filteredDrives.reduce(0) { $0 + $1.distanceM }
    }

    /// Web `filteredDrives.reduce(sum durationS)` — total SI seconds across the period.
    public var totalDurationS: Double {
        filteredDrives.reduce(0) { $0 + $1.durationS }
    }

    /// Web `total_distance / length` — mean SI meters per drive (0 when empty).
    public var avgDistanceM: Double {
        filteredDrives.isEmpty ? 0 : totalDistanceM / Double(filteredDrives.count)
    }

    /// Web `total_duration / length` — mean SI seconds per drive (0 when empty).
    public var avgDurationS: Double {
        filteredDrives.isEmpty ? 0 : totalDurationS / Double(filteredDrives.count)
    }

    /// Web `Math.max(...maxSpeedMps)` — the period's top SI speed (0 when empty).
    public var highestMaxSpeedMps: Double {
        filteredDrives.compactMap(\.maxSpeedMps).max() ?? 0
    }

    /// Web average Wh/km across the scored drives (efficiency card + Avg-Efficiency stat).
    public var avgWhPerKm: Double {
        guard !scoredDrives.isEmpty else { return 0 }
        let sum = scoredDrives.reduce(0.0) { $0 + $1.score.whPerKm }
        return sum / Double(scoredDrives.count)
    }

    /// Web average max speed in SI m/s across the scored drives (speed-discipline card).
    public var avgMaxSpeedMps: Double {
        guard !scoredDrives.isEmpty else { return 0 }
        let sum = scoredDrives.reduce(0.0) { $0 + ($1.drive.maxSpeedMps ?? 0) }
        return sum / Double(scoredDrives.count)
    }

    /// Web average power in kW across the scored drives (smoothness card; default 30 kW when absent).
    public var avgPowerKw: Double {
        guard !scoredDrives.isEmpty else { return 0 }
        let sum = scoredDrives.reduce(0.0) { $0 + (($1.drive.avgPowerW ?? 30000) / 1000) }
        return sum / Double(scoredDrives.count)
    }

    // MARK: - Sort comparator (web `sortedDrives` switch)

    private func compare(_ lhs: ScoredDrive, _ rhs: ScoredDrive) -> ComparisonResult {
        switch sortField {
        case .date: compareDoubles(lhs.drive.startTs.timeIntervalSince1970, rhs.drive.startTs.timeIntervalSince1970)
        case .distance: compareDoubles(lhs.drive.distanceM, rhs.drive.distanceM)
        case .score: compareDoubles(Double(lhs.score.total), Double(rhs.score.total))
        case .efficiency: compareDoubles(lhs.score.whPerKm, rhs.score.whPerKm)
        }
    }

    private func compareDoubles(_ lhs: Double, _ rhs: Double) -> ComparisonResult {
        if lhs == rhs { return .orderedSame }
        return lhs < rhs ? .orderedAscending : .orderedDescending
    }
}
