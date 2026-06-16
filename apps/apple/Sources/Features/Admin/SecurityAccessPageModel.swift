import Foundation
import Observation

// Native SwiftUI parity model for `web/src/features/admin/pages/SecurityAccessPage.tsx`
// (route `/security-access`). The web page reads the latest security event (polled
// `security/latest`), the security-event history (`useSecurityEvents`), and the
// vehicle list (`useVehicles`), derives the security posture + per-section inputs,
// and renders them through a column of feature components. This `@Observable` holder
// reproduces that orchestration: it owns the page load lifecycle, the vehicle +
// range filters (web `VehicleSelect` / `RangePicker`), and every already-shipped
// child feature-view model, feeding them from one cohesive report through the pure
// `SecurityAccessProjection`. No networking lives in the view (ADR-004); the report
// is read through the injected `SecurityAccessDataSource` seam, defaulting to the
// sample source so the page renders populated out of the box (the live KMP-backed
// source is injected at registration, mirroring the sibling admin pages).

// MARK: - Signal reading (web `SecurityEvent` field union — string | boolean | null)

/// The raw value of a security signal as it arrives from the API (`signal.SignalValue`,
/// Go `interface{}`): a native boolean, a string enum, or absent. Mirrors the per-child
/// signal unions so the page can carry one superset reading and project it into each
/// section's own signal type.
public enum SecuritySignalReading: Sendable, Equatable {
    case bool(Bool)
    case text(String)
    case absent

    /// JavaScript truthiness (web `value ?`): a `true` boolean or a non-empty string is
    /// truthy; `false`, the empty string, and absent are falsy.
    public var isTruthy: Bool {
        switch self {
        case let .bool(flag): flag
        case let .text(raw): !raw.isEmpty
        case .absent: false
        }
    }

    /// Web `asNonEmptyString`: a non-empty string value, else `nil`.
    public var nonEmptyString: String? {
        if case let .text(value) = self, !value.isEmpty { return value }
        return nil
    }
}

// MARK: - Vehicle option (web `useVehicles` subset for `VehicleSelect`)

/// One selectable vehicle — the native mirror of the `useVehicles` rows the web
/// `VehicleSelect` renders. Only the id + display name the picker needs are modeled.
public struct SecurityAccessVehicle: Identifiable, Equatable, Sendable {
    public let id: String
    public let displayName: String

    public init(id: String, displayName: String) {
        self.id = id
        self.displayName = displayName
    }
}

// MARK: - Range filter (web `useRangeState` — client-side history window)

/// The history window the page filters on (web `RangePicker` presets). The web page
/// filters the fetched history client-side by `createdAt`; the native model reproduces
/// that with a lookback span, defaulting to `all` (the web `defaultPresetId: 'all'`).
public enum SecurityAccessRange: String, CaseIterable, Sendable, Identifiable {
    case day
    case week
    case month
    case all

    public var id: String { rawValue }

    /// The localized segmented-control label key.
    public var labelKey: String {
        switch self {
        case .day: "admin.security.range.24h"
        case .week: "admin.security.range.7d"
        case .month: "admin.security.range.30d"
        case .all: "admin.security.range.all"
        }
    }

    /// The lookback window in seconds (`nil` = no bound, i.e. `all`).
    public var lookback: TimeInterval? {
        switch self {
        case .day: 24 * 3600
        case .week: 7 * 24 * 3600
        case .month: 30 * 24 * 3600
        case .all: nil
        }
    }
}

// MARK: - Latest security reading (web `SecurityEvent` superset the page derives from)

/// The cached "latest security event" the page derives its posture, alert, digital
/// twin, and the cards / windows / live-state sections from (web `security/latest`).
/// A superset of the fields each child reads so a single reading projects into every
/// section's own latest type.
public struct SecurityReading: Sendable, Equatable {
    public var locked: Bool?
    public var sentryMode: SecuritySignalReading
    public var doorState: SecuritySignalReading
    public var frontDriverWindow: SecuritySignalReading
    public var frontPassengerWindow: SecuritySignalReading
    public var rearDriverWindow: SecuritySignalReading
    public var rearPassengerWindow: SecuritySignalReading
    public var homelinkNearby: Bool?
    public var guestMode: Bool?
    public var lightsHazardsActive: Bool?
    public var lightsHighBeams: Bool?
    public var lightsTurnSignal: SecuritySignalReading
    public var driverSeatOccupied: Bool?
    public var pairedPhoneKeyCount: Int?
    public var valetModeEnabled: Bool?
    public var serviceMode: Bool?
    public var speedLimitMode: SecuritySignalReading
    public var homelinkDeviceCount: Int?
    public var centerDisplay: SecuritySignalReading
    public var createdAt: Date?

    public init(
        locked: Bool? = nil,
        sentryMode: SecuritySignalReading = .absent,
        doorState: SecuritySignalReading = .absent,
        frontDriverWindow: SecuritySignalReading = .absent,
        frontPassengerWindow: SecuritySignalReading = .absent,
        rearDriverWindow: SecuritySignalReading = .absent,
        rearPassengerWindow: SecuritySignalReading = .absent,
        homelinkNearby: Bool? = nil,
        guestMode: Bool? = nil,
        lightsHazardsActive: Bool? = nil,
        lightsHighBeams: Bool? = nil,
        lightsTurnSignal: SecuritySignalReading = .absent,
        driverSeatOccupied: Bool? = nil,
        pairedPhoneKeyCount: Int? = nil,
        valetModeEnabled: Bool? = nil,
        serviceMode: Bool? = nil,
        speedLimitMode: SecuritySignalReading = .absent,
        homelinkDeviceCount: Int? = nil,
        centerDisplay: SecuritySignalReading = .absent,
        createdAt: Date? = nil
    ) {
        self.locked = locked
        self.sentryMode = sentryMode
        self.doorState = doorState
        self.frontDriverWindow = frontDriverWindow
        self.frontPassengerWindow = frontPassengerWindow
        self.rearDriverWindow = rearDriverWindow
        self.rearPassengerWindow = rearPassengerWindow
        self.homelinkNearby = homelinkNearby
        self.guestMode = guestMode
        self.lightsHazardsActive = lightsHazardsActive
        self.lightsHighBeams = lightsHighBeams
        self.lightsTurnSignal = lightsTurnSignal
        self.driverSeatOccupied = driverSeatOccupied
        self.pairedPhoneKeyCount = pairedPhoneKeyCount
        self.valetModeEnabled = valetModeEnabled
        self.serviceMode = serviceMode
        self.speedLimitMode = speedLimitMode
        self.homelinkDeviceCount = homelinkDeviceCount
        self.centerDisplay = centerDisplay
        self.createdAt = createdAt
    }

    /// The four cabin windows in web render order (fd, fp, rd, rp).
    public var windows: [SecuritySignalReading] {
        [frontDriverWindow, frontPassengerWindow, rearDriverWindow, rearPassengerWindow]
    }
}

// MARK: - Cohesive report (web latest + history + vehicles, read once per load)

/// One settled page read — the native mirror of the three web queries the page reads
/// (`security/latest`, `useSecurityEvents`, `useVehicles`). The model derives every
/// section's input from this through `SecurityAccessProjection`.
public struct SecurityAccessReport: Sendable, Equatable {
    public var vehicles: [SecurityAccessVehicle]
    public var latest: SecurityReading?
    public var history: [SecurityEventInput]

    public init(
        vehicles: [SecurityAccessVehicle] = [],
        latest: SecurityReading? = nil,
        history: [SecurityEventInput] = []
    ) {
        self.vehicles = vehicles
        self.latest = latest
        self.history = history
    }
}

// MARK: - Data-source seam (ADR-004; web useSecurityEvents + security/latest + useVehicles)

/// The seam the page reads through. The production app implements this over the shared
/// KMP core repositories (the security-event history + latest queries and the vehicle
/// list); previews + tests inject the sample / fixture source. The view never performs
/// I/O itself.
public protocol SecurityAccessDataSource: Sendable {
    func load(vehicleID: String?) async throws -> SecurityAccessReport
}

// MARK: - Page state (web `PageContainer` query phases)

/// The page's data state for the security read. `.loaded` carries the resolved report;
/// `.error` is a retryable failure (web `PageContainer` error / `AlertBanner`). The
/// per-section loading / empty / error chrome is owned by the child surfaces.
public enum SecurityAccessPageState: Sendable, Equatable {
    case loading
    case loaded
    case error(String)
}

// MARK: - Page model

/// The `@Observable` state holder the Security & Access page binds to (ADR-004 — no
/// networking in the view). Owns the page load lifecycle, the vehicle + range filters,
/// the derived security posture, and every child feature-view model, feeding them from
/// the loaded report through the pure projection.
@MainActor
@Observable
public final class SecurityAccessPageModel {
    public private(set) var state: SecurityAccessPageState = .loading
    public private(set) var vehicles: [SecurityAccessVehicle] = []
    public private(set) var selectedVehicleID: String?
    public private(set) var latest: SecurityReading?
    public private(set) var totalEvents = 0
    public private(set) var range: SecurityAccessRange = .all

    // Child feature-view models (each already a shipped P4 unit) + their push sources.
    public let summary: SummaryStatsModel
    public let cards: SecurityCardsModel
    public let windows: WindowStatusModel
    public let liveState: LiveVehicleStateModel
    public let sentry: SentryModeChartModel
    public let statistics: SecurityStatisticsModel
    public let history: EventHistoryModel
    public let timeline: EventTimelineModel

    @ObservationIgnored private let summarySource: InMemorySummaryStatsSource
    @ObservationIgnored private let cardsSource: InMemorySecurityCardsSource
    @ObservationIgnored private let windowsSource: InMemoryWindowStatusSource
    @ObservationIgnored private let liveStateSource: InMemoryLiveVehicleStateSource
    @ObservationIgnored private let sentrySource: InMemorySentryModeSource
    @ObservationIgnored private let statisticsSource: InMemorySecurityStatisticsSource
    @ObservationIgnored private let historySource: InMemoryEventHistorySource
    @ObservationIgnored private let timelineSource: InMemoryEventTimelineSource

    @ObservationIgnored private let dataSource: any SecurityAccessDataSource
    @ObservationIgnored private let clock: @Sendable () -> Date

    public init(
        dataSource: any SecurityAccessDataSource = SampleSecurityAccessDataSource(),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.dataSource = dataSource
        self.clock = clock

        // Seed each child from the static sample so the surfaces render populated even
        // before the first `load()` resolves (mirrors the sibling pages' sample seeding).
        let seed = SecurityAccessSampleData.report()
        let now = clock()
        let seedHistory = SecurityAccessProjection.filterHistory(seed.history, range: .all, now: now)

        summarySource = InMemorySummaryStatsSource(
            initial: SecurityAccessProjection.summaryInput(latest: seed.latest, history: seedHistory, now: now)
        )
        summary = SummaryStatsModel(source: summarySource)

        cardsSource = InMemorySecurityCardsSource(
            initial: SecurityAccessProjection.cardsUpdate(seed.latest)
        )
        cards = SecurityCardsModel(source: cardsSource)

        windowsSource = InMemoryWindowStatusSource(
            initial: SecurityAccessProjection.windowInput(seed.latest)
        )
        windows = WindowStatusModel(source: windowsSource)

        liveStateSource = InMemoryLiveVehicleStateSource(
            initial: SecurityAccessProjection.liveStateUpdate(seed.latest)
        )
        liveState = LiveVehicleStateModel(source: liveStateSource)

        sentrySource = InMemorySentryModeSource(
            initial: SecurityAccessProjection.sentryUpdate(seedHistory, now: now)
        )
        sentry = SentryModeChartModel(source: sentrySource)

        statisticsSource = InMemorySecurityStatisticsSource(
            outcome: SecurityAccessProjection.statisticsOutcome(seedHistory)
        )
        statistics = SecurityStatisticsModel(source: statisticsSource)

        historySource = InMemoryEventHistorySource(
            initial: EventHistoryInput(events: seedHistory, isLoading: false)
        )
        history = EventHistoryModel(source: historySource)

        timelineSource = InMemoryEventTimelineSource(
            initial: SecurityAccessProjection.timelineUpdate(seedHistory)
        )
        timeline = EventTimelineModel(source: timelineSource)
    }

    // MARK: Derived posture (web `isSecure` + alert / twin guards)

    /// Web `isSecure`: locked AND the door is closed AND every window is closed. With no
    /// reading yet the web treats the vehicle as secure (no alarming banner on an empty
    /// load), so this returns `true` when `latest` is nil.
    public var isSecure: Bool {
        guard let latest else { return true }
        return (latest.locked ?? false)
            && SecurityAccessPosture.doorClosed(latest.doorState)
            && SecurityAccessPosture.allWindowsClosed(latest)
    }

    /// Whether the not-secure alert panel (web `GlassPanel` #1) renders — only when a
    /// reading exists and the vehicle is not secure (web `!isSecure && latest`).
    public var showsAlert: Bool {
        latest != nil && !isSecure
    }

    /// Whether the digital-twin panel (web `GlassPanel` #2) renders — only when a
    /// reading exists (web `latest && …`).
    public var showsTwin: Bool {
        latest != nil
    }

    /// The currently selected vehicle's display name, for the picker label.
    public var selectedVehicleName: String? {
        guard let selectedVehicleID else { return nil }
        return vehicles.first { $0.id == selectedVehicleID }?.displayName
    }

    // MARK: Lifecycle

    /// Loads the report and resolves the terminal state, then feeds every child surface
    /// from it (web: page-level queries derive the section props). On failure the page
    /// surfaces the retryable error state (web `PageContainer` error / `AlertBanner`).
    public func load() async {
        state = .loading
        do {
            let report = try await dataSource.load(vehicleID: selectedVehicleID)
            apply(report)
            state = .loaded
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Re-runs the load (web error-retry / refetch / the 5s `security/latest` poll).
    public func refresh() async {
        await load()
    }

    /// Selects a vehicle and reloads (web `VehicleSelect` → `useSelectedVehicle`).
    public func selectVehicle(_ id: String?) {
        selectedVehicleID = id
        Task { await load() }
    }

    /// Sets the history range and re-projects the windowed sections (web `RangePicker`).
    public func setRange(_ range: SecurityAccessRange) {
        self.range = range
        guard let latest, case .loaded = state else { return }
        let filtered = SecurityAccessProjection.filterHistory(historyCache, range: range, now: clock())
        feedHistorySections(latest: latest, filtered: filtered)
    }

    @ObservationIgnored private var historyCache: [SecurityEventInput] = []

    private func apply(_ report: SecurityAccessReport) {
        vehicles = report.vehicles
        if selectedVehicleID == nil {
            selectedVehicleID = report.vehicles.first?.id
        }
        latest = report.latest
        historyCache = report.history

        let now = clock()
        let filtered = SecurityAccessProjection.filterHistory(report.history, range: range, now: now)

        cardsSource.push(SecurityAccessProjection.cardsUpdate(report.latest))
        windowsSource.push(SecurityAccessProjection.windowInput(report.latest))
        liveStateSource.push(SecurityAccessProjection.liveStateUpdate(report.latest))
        feedHistorySections(latest: report.latest, filtered: filtered)
    }

    private func feedHistorySections(latest: SecurityReading?, filtered: [SecurityEventInput]) {
        let now = clock()
        totalEvents = filtered.count
        summarySource.push(
            SecurityAccessProjection.summaryInput(latest: latest, history: filtered, now: now)
        )
        sentrySource.push(SecurityAccessProjection.sentryUpdate(filtered, now: now))
        statisticsSource.push(SecurityAccessProjection.statisticsOutcome(filtered))
        historySource.push(EventHistoryInput(events: filtered, isLoading: false))
        timelineSource.push(SecurityAccessProjection.timelineUpdate(filtered))
    }
}
