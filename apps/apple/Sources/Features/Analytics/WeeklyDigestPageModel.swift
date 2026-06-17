import Foundation
import Observation

/// The `@Observable` state holder the Weekly Digest page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle selection (web `useVehicles` + `Select`), the selected week (web
/// `weekOffset` state), and the page phase, and exposes one cached `DigestComputed` bundle the view
/// reads from. The web page loads all activity for a vehicle once and re-filters client-side per week
/// (no per-week refetch); changing the vehicle reloads its activity (web query re-key).
@MainActor
@Observable
public final class WeeklyDigestPageModel {
    public private(set) var phase: WeeklyDigestPhase = .loading

    /// Whether a background reload is in flight while content is still shown (web `isFetching`).
    public private(set) var isRefreshing = false

    public private(set) var vehicles: [DigestVehicle] = []
    public private(set) var selectedVehicleID = ""
    public private(set) var weekOffset = 0

    /// The derived digest for the selected vehicle + week (web `useWeeklyDigest` memoized outputs),
    /// recomputed only when the activity, vehicle, or week changes.
    public private(set) var computed: DigestComputed = .empty

    /// When the activity last loaded successfully (drives the freshness staleness, ADR-013).
    public private(set) var lastUpdated: Date?

    @ObservationIgnored private var activity: DigestActivity?
    @ObservationIgnored private let dataSource: any WeeklyDigestDataSource
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let referenceDate: Date
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let locale: Locale

    public init(
        dataSource: any WeeklyDigestDataSource = SampleWeeklyDigestDataSource(),
        now: @escaping @Sendable () -> Date = { Date() },
        calendar: Calendar = .current,
        locale: Locale = .current
    ) {
        self.dataSource = dataSource
        self.now = now
        referenceDate = now()
        self.calendar = calendar
        self.locale = locale
    }

    // MARK: Derived (web `vehicleOptions` / `weekLabel` / `isCurrentWeek`)

    /// Web `vehicleOptions` — the `Select` choices.
    public var vehicleOptions: [DigestVehicleOption] {
        vehicles.map { DigestVehicleOption(id: $0.id, label: $0.name) }
    }

    /// Web `weekLabel` — re-derived from pure date math so navigation updates it synchronously.
    public var weekLabel: String {
        WeeklyDigestCalendar.weekLabel(offset: weekOffset, now: referenceDate, calendar: calendar, locale: locale)
    }

    /// Web `isCurrentWeek = weekOffset === 0` (drives the `Current` badge + the Next gate).
    public var isCurrentWeek: Bool {
        weekOffset == 0
    }

    /// Seconds since the activity last loaded, or `nil` before the first success.
    public var secondsSinceUpdate: TimeInterval? {
        lastUpdated.map { now().timeIntervalSince($0) }
    }

    /// Live values older than two minutes are stale (ADR-013).
    public var isStale: Bool {
        (secondsSinceUpdate ?? 0) > 120
    }

    // MARK: Lifecycle (web `useVehicles` + drives/charging/alerts query lifecycle)

    /// Loads the vehicle list + the first vehicle's activity and resolves the phase.
    public func load() async {
        phase = .loading
        await loadAll()
    }

    /// Re-runs the full load while keeping current content visible (web refetch / Retry).
    public func refresh() async {
        isRefreshing = true
        await loadAll()
        isRefreshing = false
    }

    /// Selects a vehicle and reloads its activity (web `setVehicleId` → query re-key). No-op when the
    /// id is unchanged.
    public func selectVehicle(_ id: String) {
        guard id != selectedVehicleID else { return }
        selectedVehicleID = id
        Task { await reloadActivity() }
    }

    /// Steps to the previous week (web `goToPrevWeek`) — re-filters the loaded activity, no refetch.
    public func goToPreviousWeek() {
        weekOffset -= 1
        recompute()
        resolvePhase()
    }

    /// Steps to the next week (web `goToNextWeek`), no-op on the current week so the digest never
    /// advances into the future.
    public func goToNextWeek() {
        guard !isCurrentWeek else { return }
        weekOffset += 1
        recompute()
        resolvePhase()
    }

    // MARK: Loading internals

    private func loadAll() async {
        do {
            let loaded = try await dataSource.loadVehicles()
            vehicles = loaded
            if selectedVehicleID.isEmpty {
                selectedVehicleID = loaded.first?.id ?? ""
            }
            guard !selectedVehicleID.isEmpty else {
                activity = nil
                recompute()
                phase = .empty
                return
            }
            activity = try await dataSource.loadActivity(vehicleID: selectedVehicleID)
            recompute()
            resolvePhase()
            lastUpdated = now()
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    private func reloadActivity() async {
        guard !selectedVehicleID.isEmpty else { return }
        isRefreshing = true
        do {
            activity = try await dataSource.loadActivity(vehicleID: selectedVehicleID)
            recompute()
            resolvePhase()
            lastUpdated = now()
        } catch {
            phase = .error(error.localizedDescription)
        }
        isRefreshing = false
    }

    private func recompute() {
        computed = WeeklyDigestProjection.compute(
            activity: activity ?? .empty,
            offset: weekOffset,
            now: referenceDate,
            calendar: calendar
        )
    }

    /// Web `!hasData ? <EmptyState /> : <digest />` — the selected week's activity gates the page.
    private func resolvePhase() {
        phase = computed.hasData ? .ready : .empty
    }
}
