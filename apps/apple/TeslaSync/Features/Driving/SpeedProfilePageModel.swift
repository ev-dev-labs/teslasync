//
//  SpeedProfilePageModel.swift
//  TeslaSync — P4 feature view · P7 · driving/SpeedProfile (Apple) — View Model
//
//  Full parity with web/src/features/driving/pages/SpeedProfilePage.tsx (route
//  `/speed-profile`). An `@Observable` model that drives the view from the shared
//  KMP core (ADR-004). The web TanStack queries are kept under their original
//  shape at the Swift call sites (`useSpeedProfile`, `useDrives`, plus the
//  `useSelectedVehicle` chrome) in `SpeedProfileDataSource`; that is the only seam
//  that changes when the generated client lands (P1/S2-S3). The view never touches
//  the network and holds no business logic. Every measurement stays SI here
//  (m/s, Wh/km); conversion to the user's unit happens only at the render boundary
//  (`SpeedProfileFormat`, P1/S5).
//

import Foundation
import Observation

// MARK: - Vehicle (web `useSelectedVehicle` → `GET /vehicles`)

/// One selectable vehicle (web `vehicle.display_name || vehicle.vin`). Identity +
/// label strings, not SI measurements, so they round-trip verbatim.
struct SpeedProfileVehicle: Identifiable, Hashable {
    let id: Int64
    let displayName: String
    let vin: String

    /// Web `vehicle.display_name || vehicle.vin` — the label shown in the selector.
    var name: String {
        displayName.isEmpty ? vin : displayName
    }
}

// MARK: - Speed bucket (web `SpeedBucket`)

/// One speed-distribution bucket the analytics endpoint returns (web `SpeedBucket`):
/// the display-unit range label (e.g. `"0-15"`, `"15-30"`) and the reading count.
/// The range label literals are already in the user's display speed unit (web
/// behavior); the count is unit-free.
struct SpeedProfileBucket: Identifiable, Hashable {
    /// Web `speedBucket ?? speed_bucket` — the range label (display-unit literals).
    let label: String
    /// Web `readings` — the bucket's sample count (drives the bar + card numbers).
    let readings: Int

    var id: String {
        label
    }

    /// The numeric `[lo, hi)` bounds parsed from the label (web `bucket.match(/(\d+)/g)`),
    /// in display speed units. `hi` defaults high for an open-ended top bucket.
    var bounds: (lo: Double, hi: Double)? {
        let numbers = label.split(whereSeparator: { !$0.isNumber }).compactMap { Double($0) }
        guard let lo = numbers.first else { return nil }
        let hi = numbers.count > 1 ? numbers[1] : 999
        return (lo, hi)
    }
}

// MARK: - Speed-profile summary (web `SpeedProfileData`)

/// The analytics speed-profile response (web `SpeedProfileData`): the per-bucket
/// distribution plus the average / peak / optimal speeds in SI meters-per-second.
struct SpeedProfileSummary: Equatable {
    let distribution: [SpeedProfileBucket]
    let avgSpeedMps: Double
    let peakSpeedMps: Double
    let optimalSpeedMps: Double

    /// Web `totalReadings = distribution.reduce((s, b) => s + (b.readings ?? 0), 0)`.
    var totalReadings: Int {
        distribution.reduce(0) { $0 + $1.readings }
    }
}

// MARK: - Drive (web `useDrives` → `GET /drives`)

/// One drive feeding the scatter cloud + per-bucket efficiency table (web `Drive`).
/// All measurements SI (meters, Wh, m/s, %); efficiency derives on demand and
/// converts at the display boundary.
struct SpeedProfileDrive: Identifiable, Hashable {
    let id: Int64
    let startTs: Date
    let distanceM: Double
    let energyUsedWh: Double?
    let startBatteryPct: Double?
    let endBatteryPct: Double?
    let avgSpeedMps: Double?

    /// Web `getEfficiency(drive)` → consumption in `Wh/km` (SI) or `nil`. Prefers the
    /// measured energy; otherwise estimates from the battery delta (75 kWh pack).
    var efficiencyWhPerKm: Double? {
        guard distanceM > 0 else { return nil }
        let km = distanceM / 1000
        if let wh = energyUsedWh, wh > 0 {
            return wh / km
        }
        let batteryUsed = (startBatteryPct ?? 0) - (endBatteryPct ?? 0)
        guard batteryUsed > 0 else { return nil }
        return (batteryUsed * 0.75 * 1000) / km
    }
}

// MARK: - Scatter sample (web `scatterData` element, kept SI)

/// One efficiency-vs-speed sample (web `scatterData` point) kept in SI; the view
/// converts speed (m/s) + consumption (Wh/km) and picks the band color at render.
struct SpeedScatterSample: Identifiable {
    let id: String
    let speedMps: Double
    let efficiencyWhPerKm: Double
}

// MARK: - Data source seam (web hooks: useSelectedVehicle / useSpeedProfile / useDrives)

/// Supplies every datum the page renders. The production implementation binds the
/// shared KMP repositories/use-cases (ADR-004 — the view holds no networking);
/// previews and tests inject doubles to drive the loading / empty / error / success
/// states.
///
/// Method ↔ web hook map (names kept at the Swift call sites per the parity manifest):
/// `loadVehicles` ← `useSelectedVehicle`/`GET /vehicles`;
/// `useSpeedProfile` ← `GET /analytics/speed-profile?vehicle_id&start&end`;
/// `useDrives` ← `GET /drives?vehicle_id`.
protocol SpeedProfileDataSource: Sendable {
    func loadVehicles() async throws -> [SpeedProfileVehicle]
    func useSpeedProfile(vehicleID: Int64, start: Date?, end: Date) async throws -> SpeedProfileSummary?
    func useDrives(vehicleID: Int64) async throws -> [SpeedProfileDrive]
}

// MARK: - Date range presets (web `RangePicker` / `useRangeState`, default `all`)

/// Client-side history window presets (web `RangePicker` presets, `defaultPresetId: 'all'`).
/// The window bounds both the `useSpeedProfile` query and the client-side drive filter.
enum SpeedProfileRange: String, CaseIterable, Identifiable, Equatable {
    case sevenDays = "7d"
    case thirtyDays = "30d"
    case ninetyDays = "90d"
    case monthToDate = "mtd"
    case yearToDate = "ytd"
    case all

    var id: String {
        rawValue
    }

    /// Localized menu label (reuses the shared range catalog keys).
    var label: String {
        switch self {
        case .sevenDays: String(localized: "translation.range.7d", defaultValue: "Last 7 Days")
        case .thirtyDays: String(localized: "translation.range.30d", defaultValue: "Last 30 Days")
        case .ninetyDays: String(localized: "translation.range.90d", defaultValue: "Last 90 Days")
        case .monthToDate: String(localized: "translation.range.mtd", defaultValue: "Month to Date")
        case .yearToDate: String(localized: "translation.range.ytd", defaultValue: "Year to Date")
        case .all: String(localized: "translation.range.all", defaultValue: "All Time")
        }
    }

    /// `[start, end]` window for `now` (`nil` start = unbounded "all"); end is the end
    /// of `now`'s day so today's drives are always included (web `endMs`).
    func window(now: Date = Date(), calendar: Calendar = .current) -> (start: Date?, end: Date) {
        let endOfDay = calendar.date(bySettingHour: 23, minute: 59, second: 59, of: now) ?? now
        switch self {
        case .sevenDays:
            return (calendar.date(byAdding: .day, value: -7, to: now), endOfDay)
        case .thirtyDays:
            return (calendar.date(byAdding: .day, value: -30, to: now), endOfDay)
        case .ninetyDays:
            return (calendar.date(byAdding: .day, value: -90, to: now), endOfDay)
        case .monthToDate:
            return (calendar.dateInterval(of: .month, for: now)?.start, endOfDay)
        case .yearToDate:
            return (calendar.dateInterval(of: .year, for: now)?.start, endOfDay)
        case .all:
            return (nil, .distantFuture)
        }
    }
}

// MARK: - Page phase (web `isLoading ? … : error ? … : data ? content : EmptyState`)

/// The page's terminal phase. `.empty` is a successful load whose speed-profile
/// response is absent (web `data` falsy → the `speedProfile.noData` `EmptyState`);
/// `.error` is a retryable load failure (web `PageContainer error`); `.ready` carries
/// a summary.
enum SpeedProfilePhase: Equatable {
    case loading
    case empty
    case error(String)
    case ready
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the vehicle list + selection (web `useSelectedVehicle`), the range
/// filter (web `useRangeState`), the speed-profile summary (web `useSpeedProfile`)
/// and the drive list (web `useDrives`), and derives every panel/chart value (web
/// `useMemo` blocks) in SI. Reads everything through the injected
/// `SpeedProfileDataSource`.
@MainActor
@Observable
final class SpeedProfilePageModel {
    /// The load state (web TanStack `isLoading` / `error` / success for `useSpeedProfile`).
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var loadState: LoadState = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    private(set) var isRefreshing = false

    private(set) var vehicles: [SpeedProfileVehicle] = []
    private(set) var selectedVehicleID: Int64?

    /// Web `useSpeedProfile` result — the distribution + avg/peak/optimal speeds.
    private(set) var summary: SpeedProfileSummary?

    /// Web `useDrives` result — every drive for the selected vehicle (filtered to the
    /// window client-side by `windowedDrives`).
    private(set) var allDrives: [SpeedProfileDrive] = []

    /// The selected window preset (web `useRangeState`, default `all`).
    var selectedRange: SpeedProfileRange = .all

    @ObservationIgnored private let dataSource: any SpeedProfileDataSource
    @ObservationIgnored private let referenceDate: Date

    init(
        dataSource: any SpeedProfileDataSource = SampleSpeedProfileDataSource(),
        referenceDate: Date = Date()
    ) {
        self.dataSource = dataSource
        self.referenceDate = referenceDate
    }

    // MARK: Phase

    /// The displayed phase (web `PageContainer` phases): loading/error from the
    /// source, then empty when there is no summary (web `data` falsy), else ready.
    var phase: SpeedProfilePhase {
        switch loadState {
        case .loading: .loading
        case let .failed(message): .error(message)
        case .loaded: summary == nil ? .empty : .ready
        }
    }

    // MARK: Selection

    var selectedVehicle: SpeedProfileVehicle? {
        selectedVehicleID.flatMap { id in vehicles.first { $0.id == id } }
    }

    // MARK: Loading

    /// Loads the vehicle list, then the selected vehicle's speed profile + drives
    /// (web `useSelectedVehicle` + `useSpeedProfile` + `useDrives`).
    func load() async {
        loadState = .loading
        await fetchAll()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    func refresh() async {
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

    /// Selects a vehicle (web global `VehicleSelect`) and reloads its data (web
    /// `useSpeedProfile`/`useDrives` keyed on `vehicleId`).
    func selectVehicle(_ id: Int64) async {
        guard id != selectedVehicleID, vehicles.contains(where: { $0.id == id }) else { return }
        selectedVehicleID = id
        loadState = .loading
        await loadSelectedVehicle()
    }

    /// Applies a new window preset (web `RangePicker.onChange`). Re-fetches the
    /// summary (web `useSpeedProfile` re-keys on `[start, end]`); the drive list is
    /// filtered client-side, so it is not re-fetched (web `useDrives` is not range-keyed).
    func selectRange(_ range: SpeedProfileRange) async {
        guard range != selectedRange else { return }
        selectedRange = range
        loadState = .loading
        await loadSummary()
    }

    private func loadSelectedVehicle() async {
        guard let id = selectedVehicleID else {
            summary = nil
            allDrives = []
            loadState = .loaded
            return
        }
        allDrives = await (try? dataSource.useDrives(vehicleID: id)) ?? []
        await loadSummary()
    }

    private func loadSummary() async {
        guard let id = selectedVehicleID else {
            summary = nil
            loadState = .loaded
            return
        }
        let window = selectedRange.window(now: referenceDate)
        do {
            summary = try await dataSource.useSpeedProfile(vehicleID: id, start: window.start, end: window.end)
            loadState = .loaded
        } catch {
            summary = nil
            loadState = .failed(error.localizedDescription)
        }
    }

    /// Surfaced by the live client when the primary query fails (web `error` →
    /// `PageContainer error`). Wired so the `.error` branch is real logic.
    func fail(_ message: String) {
        loadState = .failed(message)
    }

    // MARK: Derivations (web useMemo blocks — SI / unit-independent)

    /// Web `drives` memo: `allDrives` narrowed to the picked window by `startTs`.
    var windowedDrives: [SpeedProfileDrive] {
        guard !allDrives.isEmpty else { return allDrives }
        let window = selectedRange.window(now: referenceDate)
        let startBound = window.start
        return allDrives.filter { drive in
            if let start = startBound, drive.startTs < start { return false }
            return drive.startTs <= window.end
        }
    }

    /// Web `scatterData` (kept SI): windowed drives with a non-zero average speed and
    /// a derivable efficiency. The display speed/efficiency + band color are applied
    /// at render (`SpeedProfileFormat`).
    var scatterSamples: [SpeedScatterSample] {
        windowedDrives.compactMap { drive in
            guard let mps = drive.avgSpeedMps, mps != 0, let efficiency = drive.efficiencyWhPerKm else {
                return nil
            }
            return SpeedScatterSample(id: "\(drive.id)", speedMps: mps, efficiencyWhPerKm: efficiency)
        }
    }

    /// Web `scatterData.length > 3` — the threshold for plotting the scatter cloud.
    var hasScatter: Bool {
        scatterSamples.count > 3
    }

    /// Web `(data.optimalSpeedMps ?? 0) > 0` — whether the efficiency insight applies.
    var hasInsight: Bool {
        (summary?.optimalSpeedMps ?? 0) > 0
    }
}
