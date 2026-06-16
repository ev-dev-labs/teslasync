import Foundation
import Observation

// MARK: - Data source seam (web `useDrive`)

/// Supplies the drive the page replays. The production implementation binds the shared KMP
/// repositories/use-cases (ADR-004 — the view holds no networking); previews and tests inject
/// doubles to drive the loading / empty / error states. Mirrors the sibling `DriveDetailDataSource`
/// seam. Method ↔ web map: `loadDrive` ← `useDrive(id)` / `GET /drives/{id}`.
public protocol TripReplayDataSource: Sendable {
    func loadDrive(driveID: Int64) async throws -> TripReplayRecord
}

// MARK: - Component bridges (page → canonical surfaces)

/// Page-owned `TripReplayMapSource` adapter. The page is the single source of truth (web
/// `TripReplayPage` owns `currentIndex` and feeds `<TripReplayMap>` via props); this bridge
/// publishes the page's snapshot into the bound `TripReplayMap` and routes a polyline-tap seek back
/// to the page model (web `onSeekToIndex`).
@MainActor
final class TripReplayPageMapBridge: TripReplayMapSource {
    var onUpdate: (@MainActor (TripReplayMapInput) -> Void)?
    var onStartOrRefresh: (@MainActor () -> Void)?
    var onSeekIndex: (@MainActor (Int) -> Void)?

    func start() { onStartOrRefresh?() }
    func stop() {}
    func refresh() { onStartOrRefresh?() }
    func seek(to index: Int) { onSeekIndex?(index) }
    func publish(_ input: TripReplayMapInput) { onUpdate?(input) }
}

/// Page-owned `TripReplayChartsSource` adapter (web `<TripReplayCharts>` fed by the page). Publishes
/// the page's snapshot into the bound `TripReplayCharts`; the chart's own `onSeek` callback is wired
/// straight to the page model.
@MainActor
final class TripReplayPageChartsBridge: TripReplayChartsSource {
    var onUpdate: (@MainActor (TripReplayChartsUpdate) -> Void)?
    var onStartOrRefresh: (@MainActor () -> Void)?

    func start() { onStartOrRefresh?() }
    func stop() {}
    func refresh() { onStartOrRefresh?() }
    func publish(_ update: TripReplayChartsUpdate) { onUpdate?(update) }
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// drive plus the full replay transport (web `useTripReplay`): a virtual clock scaled by the speed
/// multiplier that maps elapsed time onto the position timeline, so the composed map, the scrubber,
/// the chart playhead, and the stat bar all derive from one source of truth (`currentIndex` /
/// `progressFraction`). It hosts the canonical `TripReplayMap` + `TripReplayCharts` surfaces (web
/// `<TripReplayMap>` / `<TripReplayCharts>`), feeding each through a page-owned bridge so the page
/// stays the single source of truth and a seek from any surface flows back here.
@MainActor
@Observable
public final class TripReplayPageModel {
    /// The drive id this page replays (web route `:id`).
    public let driveID: Int64

    public private(set) var status: TripReplayPageStatus = .loading

    /// Whether a background refetch is in flight while content is already shown
    /// (web `isFetching && !isLoading`).
    public private(set) var isRefreshing = false

    public private(set) var record: TripReplayRecord?

    /// The merged replay trail (web `positions` memo). Set once on load; stable thereafter.
    public private(set) var positions: [TripDrivePosition] = []

    /// The detected timeline markers (web `replayMarkers`). Drive the scrubber tick strip + the
    /// active-stat-card highlight.
    public private(set) var markers: [TripReplayMarker] = []

    // MARK: Transport state (web `ReplayState`)

    public private(set) var isPlaying = false
    public private(set) var speed: ReplaySpeed = .x1
    /// The playhead position index — the single source of truth every surface tracks.
    public private(set) var currentIndex = 0
    /// Continuous `0...1` elapsed fraction (web `progress`).
    public private(set) var progressFraction = 0.0
    /// Elapsed replay time in milliseconds (web `elapsedTime`).
    public private(set) var elapsedMs = 0.0
    /// Total replay duration in milliseconds (web `totalTime`).
    public private(set) var totalTimeMs = 0.0

    // MARK: Composed canonical surfaces (web sub-components)

    /// The route map surface (web `<TripReplayMap>`), fed by this page through `mapBridge`.
    public let mapModel: TripReplayMapModel
    /// The speed & power timeline surface (web `<TripReplayCharts>`), fed through `chartsBridge`.
    public let chartsModel: TripReplayChartsModel

    @ObservationIgnored private let mapBridge = TripReplayPageMapBridge()
    @ObservationIgnored private let chartsBridge = TripReplayPageChartsBridge()
    @ObservationIgnored private var cachedMapPositions: [TripReplayPosition] = []
    @ObservationIgnored private var cachedChartPoints: [TripReplayPoint] = []
    @ObservationIgnored private var offsets: [Double] = []
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private let dataSource: any TripReplayDataSource
    @ObservationIgnored private var unitPrefs: UnitPreferences = .metric

    /// Replay tick cadence (web `TICK_MS` — 20 fps).
    static let tickMs = 50.0

    public init(
        driveID: Int64,
        dataSource: any TripReplayDataSource = SampleTripReplayDataSource()
    ) {
        self.driveID = driveID
        self.dataSource = dataSource
        mapModel = TripReplayMapModel(source: mapBridge)
        chartsModel = TripReplayChartsModel(source: chartsBridge)
        mapBridge.onSeekIndex = { [weak self] index in self?.seekTo(index: index) }
        mapBridge.onStartOrRefresh = { [weak self] in self?.publishMap() }
        chartsBridge.onStartOrRefresh = { [weak self] in self?.publishCharts() }
        chartsModel.onSeek = { [weak self] index in self?.seekTo(index: index) }
    }

    // MARK: Derived (web memos)

    /// Whether the drive yielded a usable trail (web `positions.length > 0`).
    public var hasPositions: Bool {
        !positions.isEmpty
    }

    /// The sample under the playhead (web `replay.currentPosition`).
    public var currentPosition: TripDrivePosition? {
        positions.indices.contains(currentIndex) ? positions[currentIndex] : nil
    }

    /// The speed+power timeline series in SI (web `timelineData`) — feeds the chart-point
    /// projection and is exercised directly in tests.
    public var timelineData: [TripReplayTimelinePoint] {
        TripReplayDerivations.timelineData(positions)
    }

    /// The elevation profile series (web `elevationData`).
    public var elevationData: [TripReplayElevationPoint] {
        TripReplayDerivations.elevationData(positions)
    }

    /// The downsampled scrubber sparkline (web `speedSparkData`).
    public var speedSparkline: [Double] {
        TripReplayDerivations.speedSparkline(positions)
    }

    /// The marker nearest the playhead (web `activeMarker`), driving the stat-card highlight.
    public var activeMarker: TripReplayMarker? {
        TripReplayDerivations.nearestMarker(markers, progress: progressFraction)
    }

    // MARK: Loading

    /// Loads the drive (web `useDrive`). A failure surfaces the retryable error region.
    public func load() async {
        status = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    /// Syncs the display-unit preference from the view (the chart points carry display-unit speed).
    public func setUnitPreferences(_ prefs: UnitPreferences) {
        guard prefs != unitPrefs else { return }
        unitPrefs = prefs
        rebuildChartPoints()
        if status == .ready { publishCharts() }
    }

    private func fetch() async {
        do {
            let loaded = try await dataSource.loadDrive(driveID: driveID)
            apply(loaded)
            status = .ready
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    private func apply(_ loaded: TripReplayRecord) {
        record = loaded
        let merged = TripReplayDerivations.mergedPositions(loaded)
        positions = merged
        offsets = TripReplayDerivations.timelineOffsets(merged)
        totalTimeMs = offsets.last ?? 0
        markers = TripReplayDerivations.markers(merged)
        rebuildCaches()
        resetClock()
    }

    // MARK: Transport controls (web `ReplayControls`)

    /// Begins playback, restarting from the top if the playhead is already at the end (web `play`).
    public func play() {
        guard !positions.isEmpty, totalTimeMs > 0 else { return }
        if elapsedMs >= totalTimeMs {
            elapsedMs = 0
            setIndex(0)
        }
        isPlaying = true
        startTicker()
    }

    /// Pauses playback, leaving the playhead in place (web `pause`).
    public func pause() {
        isPlaying = false
        ticker?.cancel()
        ticker = nil
    }

    /// Stops and rewinds to the start (web `stop`).
    public func stop() {
        pause()
        elapsedMs = 0
        setIndex(0)
    }

    /// Toggles play/pause (the transport's primary button).
    public func togglePlay() {
        if isPlaying { pause() } else { play() }
    }

    /// Sets the playback-speed multiplier (web `setSpeed`).
    public func setSpeed(_ value: ReplaySpeed) {
        speed = value
    }

    /// Steps the speed slot by `delta`, clamped (web `setSpeedRelative`).
    public func stepSpeed(by delta: Int) {
        let all = ReplaySpeed.allCases
        let index = all.firstIndex(of: speed) ?? 0
        speed = all[max(0, min(all.count - 1, index + delta))]
    }

    /// Seeks to a position index (web `seekTo`) — the shared map/chart/scrubber seek channel.
    public func seekTo(index: Int) {
        guard !offsets.isEmpty else { return }
        let clamped = max(0, min(index, offsets.count - 1))
        elapsedMs = offsets[clamped]
        setIndex(clamped)
    }

    /// Seeks to a normalized `0...1` progress (web `seekToProgress`) — the scrubber drag channel.
    public func seekTo(progress: Double) {
        guard totalTimeMs > 0 else { return }
        let target = max(0, min(1, progress)) * totalTimeMs
        elapsedMs = target
        setIndex(TripReplayDerivations.indexAtTime(offsets, target))
    }

    /// Seeks by a signed number of seconds, clamped (web `seekBy` — keyboard skip).
    public func seekBy(seconds: Double) {
        guard totalTimeMs > 0, !offsets.isEmpty else { return }
        let target = max(0, min(totalTimeMs, elapsedMs + seconds * 1000))
        elapsedMs = target
        setIndex(TripReplayDerivations.indexAtTime(offsets, target))
    }

    /// Steps the playhead by `delta` frames, clamped (web `stepFrame`).
    public func stepFrame(by delta: Int) {
        guard !offsets.isEmpty else { return }
        let next = max(0, min(offsets.count - 1, currentIndex + delta))
        elapsedMs = offsets[next]
        setIndex(next)
    }

    // MARK: Clock internals

    private func resetClock() {
        pause()
        speed = .x1
        elapsedMs = 0
        setIndex(0)
    }

    /// Advances the virtual clock one tick; exposed for deterministic tests (web `tick`).
    func tick() {
        guard !offsets.isEmpty, totalTimeMs > 0 else { return }
        elapsedMs += TripReplayPageModel.tickMs * Double(speed.multiplier)
        if elapsedMs >= totalTimeMs {
            elapsedMs = totalTimeMs
            setIndex(offsets.count - 1)
            pause()
            return
        }
        setIndex(TripReplayDerivations.indexAtTime(offsets, elapsedMs))
    }

    private func setIndex(_ index: Int) {
        if currentIndex != index { currentIndex = index }
        progressFraction = totalTimeMs > 0 ? min(1, elapsedMs / totalTimeMs) : 0
        publishMap()
        publishCharts()
    }

    // MARK: Component feeding (web prop pass-down)

    private func rebuildCaches() {
        cachedMapPositions = positions.map {
            TripReplayPosition(latitude: $0.latitude, longitude: $0.longitude, speed: $0.speedMps)
        }
        rebuildChartPoints()
    }

    private func rebuildChartPoints() {
        cachedChartPoints = TripReplayDerivations.timelineData(positions).map { point in
            TripReplayPoint(
                originIndex: point.index,
                time: point.timeMin,
                speed: Units.convertSpeed(point.speedMps, unitPrefs),
                power: point.powerW / 1000
            )
        }
    }

    private func publishMap() {
        mapBridge.publish(TripReplayMapInput(
            status: .loaded,
            positions: cachedMapPositions,
            currentIndex: currentIndex,
            reduceMotion: false,
            connection: .live,
            isFetching: false,
            updatedAt: Date()
        ))
    }

    private func publishCharts() {
        chartsBridge.publish(TripReplayChartsUpdate(
            status: .loaded,
            points: cachedChartPoints,
            speedUnit: unitPrefs.speed,
            currentIndex: currentIndex,
            connection: .live,
            refreshing: false,
            updatedAt: Date()
        ))
    }

    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int(TripReplayPageModel.tickMs)))
                guard let self, self.isPlaying else { break }
                self.tick()
            }
        }
    }
}
