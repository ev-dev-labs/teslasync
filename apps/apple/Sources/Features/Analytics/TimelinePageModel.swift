import Foundation
import Observation

// MARK: - Data source seam (web hooks: useVehicles / vehicle-states timeline + summary queries)

/// Supplies every datum the page renders. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error / success states. Mirrors the
/// `StatisticsDataSource` seam used by the sibling analytics page.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useVehicles` / `GET /vehicles`; `loadTransitions` ← the inline
/// `useQuery(['vehicle-timeline'])` → `GET /vehicle-states/timeline`; `loadSummary` ← the inline
/// `useQuery(['vehicle-summary'])` → `GET /vehicle-states/summary`.
public protocol TimelineDataSource: Sendable {
    func loadVehicles() async throws -> [TimelineVehicle]
    func loadTransitions(vehicleID: Int64) async throws -> [TimelineTransitionRecord]
    func loadSummary(vehicleID: Int64) async throws -> TimelineSummary?
}

// MARK: - Page phase (web PageContainer loading + per-source empty/error + content)

/// The page's terminal phase. `.empty` is a successful load that yielded no transitions and no
/// state summary (web's all-empty panels); `.error` is a retryable failure of both sources (web
/// `anyError` banner); `.ready` carries at least some data (each panel keeps its own empty state).
public enum TimelinePhase: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// vehicle list + selection, the raw transition records and the state summary, and derives the
/// indexed table rows (web `transitions`), the daily breakdown buckets (web `dailyBreakdown`), the
/// proportional state-distribution segments (web `STATE_COLORS` bar), and the four summary metrics
/// (web `totalTransitions` / `drivingSec` / `chargingSec` / idle+sleep). Reads everything through
/// the injected `TimelineDataSource`.
@MainActor
@Observable
public final class TimelinePageModel {
    public private(set) var phase: TimelinePhase = .loading

    /// Whether a background refetch is in flight while content is already shown (web
    /// `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [TimelineVehicle] = []
    public private(set) var selectedVehicleID: Int64?

    public private(set) var transitionRecords: [TimelineTransitionRecord] = []
    public private(set) var summary: TimelineSummary?

    @ObservationIgnored private let dataSource: any TimelineDataSource

    public init(dataSource: any TimelineDataSource = SampleTimelineDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Selection

    public var selectedVehicle: TimelineVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list (web `useVehicles`) then the selected vehicle's transitions + summary.
    public func load() async {
        phase = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch / refresh button).
    public func refresh() async {
        isRefreshing = true
        await fetchAll()
        isRefreshing = false
    }

    /// Selects a vehicle (web `onPickVehicle` / `setVehicleId`) and reloads its data.
    public func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        phase = .loading
        await loadSelected()
    }

    private func fetchAll() async {
        vehicles = await (try? dataSource.loadVehicles()) ?? []
        if selectedVehicleID == nil || !vehicles.contains(where: { $0.id == selectedVehicleID }) {
            selectedVehicleID = vehicles.first?.id
        }
        await loadSelected()
    }

    private func loadSelected() async {
        guard let id = selectedVehicleID else {
            transitionRecords = []
            summary = nil
            phase = .empty
            return
        }

        var transitionsFailed = false
        var summaryFailed = false
        var firstError: String?

        do {
            transitionRecords = try await dataSource.loadTransitions(vehicleID: id)
        } catch {
            transitionRecords = []
            transitionsFailed = true
            firstError = error.localizedDescription
        }

        do {
            summary = try await dataSource.loadSummary(vehicleID: id)
        } catch {
            summary = nil
            summaryFailed = true
            firstError = firstError ?? error.localizedDescription
        }

        // Both sources down → the page can show nothing meaningful (web `anyError` + no content).
        if transitionsFailed, summaryFailed {
            phase = .error(firstError ?? "")
            return
        }

        // A selected vehicle always renders the cards + panels; each panel surfaces its own empty
        // empty state when its slice of data is missing (web never hides the panels).
        phase = .ready
    }

    // MARK: Derived — table rows (web `transitions` useMemo)

    /// Transition rows sorted ascending by timestamp, indexed, with each row's successor timestamp
    /// so the table can compute "duration in to_state" (web `transitions`).
    public var transitionRows: [TimelineTransitionRow] {
        guard !transitionRecords.isEmpty else { return [] }
        let ordered = transitionRecords.sorted { $0.timestamp < $1.timestamp }
        return ordered.enumerated().map { index, record in
            TimelineTransitionRow(
                id: index,
                timestamp: record.timestamp,
                fromState: record.fromState,
                toState: record.toState,
                triggerField: record.triggerField,
                triggerValue: record.triggerValue,
                nextTimestamp: index + 1 < ordered.count ? ordered[index + 1].timestamp : nil
            )
        }
    }

    // MARK: Derived — daily breakdown (web `dailyBreakdown` useMemo)

    /// Transitions binned by UTC calendar day and counted by destination state into the four
    /// user-facing buckets (web `dailyBreakdown`); ascending by day.
    public var dailyBuckets: [TimelineDayBucket] {
        let rows = transitionRows
        guard !rows.isEmpty else { return [] }

        var order: [String] = []
        var counts: [String: [TimelineStateCategory: Int]] = [:]
        for row in rows {
            let day = Self.utcDayKey(row.timestamp)
            if counts[day] == nil {
                order.append(day)
                counts[day] = [:]
            }
            if let bucket = TimelineStateCategory.bucket(for: row.toState) {
                counts[day]?[bucket, default: 0] += 1
            }
        }

        return order
            .map { day in
                let dayCounts = counts[day] ?? [:]
                return TimelineDayBucket(
                    day: day,
                    driving: dayCounts[.driving] ?? 0,
                    charging: dayCounts[.charging] ?? 0,
                    idle: dayCounts[.idle] ?? 0,
                    sleeping: dayCounts[.sleeping] ?? 0
                )
            }
            .sorted { $0.day < $1.day }
    }

    // MARK: Derived — state distribution (web `STATE_COLORS` proportional bar)

    /// Whether the distribution bar renders (web `summaryRows.length === 0 || totalSeconds === 0`
    /// inverted).
    public var hasStateData: Bool {
        guard let summary else { return false }
        return summary.totalSeconds > 0 && !summary.byState.isEmpty
    }

    /// The proportional bar segments: each state's width share of total time, dropping slivers
    /// below 0.3% (web `if (pct < 0.3) return null`).
    public var distributionSegments: [TimelineDistributionSegment] {
        guard let summary, summary.totalSeconds > 0 else { return [] }
        return summary.byState.compactMap { row in
            let width = row.totalSeconds / summary.totalSeconds * 100
            guard width >= 0.3 else { return nil }
            return TimelineDistributionSegment(
                state: row.state,
                widthPercent: width,
                totalSeconds: row.totalSeconds,
                percentage: row.percentage,
                colorIndex: TimelineStateColor.colorIndex(for: row.state)
            )
        }
    }

    // MARK: Derived — summary metrics (web metric cards)

    /// Web `summaryRows.reduce((s, r) => s + r.transition_count)`.
    public var totalTransitions: Int {
        (summary?.byState ?? []).reduce(0) { $0 + $1.transitionCount }
    }

    /// Web `summaryByState.driving?.totalSeconds ?? 0`.
    public var drivingSeconds: Double {
        seconds(for: "driving")
    }

    /// Web `summaryByState.charging?.totalSeconds ?? 0`.
    public var chargingSeconds: Double {
        seconds(for: "charging")
    }

    /// Web `online + parked + idle` total seconds.
    public var idleSeconds: Double {
        seconds(for: "online") + seconds(for: "parked") + seconds(for: "idle")
    }

    /// Web `asleep + sleeping + offline` total seconds.
    public var sleepingSeconds: Double {
        seconds(for: "asleep") + seconds(for: "sleeping") + seconds(for: "offline")
    }

    /// Web Idle / Sleep card value (`idleSec + sleepingSec`).
    public var idleSleepSeconds: Double {
        idleSeconds + sleepingSeconds
    }

    private func seconds(for state: String) -> Double {
        (summary?.byState ?? []).first { $0.state == state }?.totalSeconds ?? 0
    }

    /// UTC `yyyy-MM-dd` key for a timestamp (web `date.toISOString().slice(0, 10)`).
    static func utcDayKey(_ date: Date) -> String {
        utcDayFormatter.string(from: date)
    }

    private static let utcDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}
