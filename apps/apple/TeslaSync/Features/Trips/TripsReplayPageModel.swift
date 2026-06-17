import Foundation
import Observation

// MARK: - Page model (web `useDrive` + `useTripReplay`)

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view). Owns the
/// drive plus the full replay transport (web `useTripReplay`): a virtual clock scaled by the speed
/// multiplier that maps elapsed time onto the position timeline, so the scrubber, the chart
/// playheads, and the stat bar all derive from one source of truth (`currentIndex` /
/// `progressFraction`). A seek from any surface flows back through `seekTo` so the surfaces stay in
/// lockstep (web `handleSeekToIndex`).
@MainActor
@Observable
public final class TripsReplayModel {
    /// The drive id this page replays (web route `:id`).
    public let driveID: Int64

    public private(set) var state: TripsReplayState = .loading
    /// Whether a background refetch is in flight while content already shows (web refetch).
    public private(set) var isRefreshing = false
    public private(set) var record: TripsReplayRecord?

    /// The merged replay trail (web `positions` memo). Set once on load; stable thereafter.
    public private(set) var positions: [TripsReplaySample] = []
    /// The detected timeline markers (web `replayMarkers`).
    public private(set) var markers: [TripsReplayMarker] = []

    // Transport state (web `ReplayState`).
    public private(set) var isPlaying = false
    public private(set) var speed: ReplaySpeed = .x1
    /// The playhead index — the single source of truth every surface tracks.
    public private(set) var currentIndex = 0
    /// Continuous `0...1` elapsed fraction (web `progress`).
    public private(set) var progressFraction = 0.0
    /// Elapsed replay time in milliseconds (web `elapsedTime`).
    public private(set) var elapsedMs = 0.0
    /// Total replay duration in milliseconds (web `totalTime`).
    public private(set) var totalTimeMs = 0.0

    @ObservationIgnored private var offsets: [Double] = []
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private let dataSource: any TripsReplayDataSource

    /// Replay tick cadence (web `TICK_MS` — 20 fps).
    static let tickMs = 50.0

    public init(
        driveID: Int64,
        dataSource: any TripsReplayDataSource = SampleTripsReplayDataSource()
    ) {
        self.driveID = driveID
        self.dataSource = dataSource
    }

    // MARK: Derived (web memos)

    /// Whether the drive yielded a usable trail (web `positions.length > 0`).
    public var hasPositions: Bool { !positions.isEmpty }

    /// The sample under the playhead (web `replay.currentPosition`).
    public var currentPosition: TripsReplaySample? {
        positions.indices.contains(currentIndex) ? positions[currentIndex] : nil
    }

    /// The elevation profile series (web `elevationData`).
    public var elevationData: [TripsReplayElevationPoint] {
        TripsReplayDerivations.elevationData(positions)
    }

    /// The speed+power timeline series in SI (web `timelineData`).
    public var timelineData: [TripsReplayTimelinePoint] {
        TripsReplayDerivations.timelineData(positions)
    }

    /// The downsampled scrubber sparkline (web `speedSparkData`).
    public var speedSparkline: [Double] {
        TripsReplayDerivations.speedSparkline(positions)
    }

    /// The marker nearest the playhead (web `activeMarker`), driving the stat-card highlight.
    public var activeMarker: TripsReplayMarker? {
        TripsReplayDerivations.nearestMarker(markers, progress: progressFraction)
    }

    // MARK: Loading

    /// Loads the drive (web `useDrive`). A failure surfaces the retryable error region.
    public func load() async {
        state = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch).
    public func refresh() async {
        isRefreshing = true
        await fetch()
        isRefreshing = false
    }

    private func fetch() async {
        do {
            let loaded = try await dataSource.loadDrive(driveID: driveID)
            apply(loaded)
            state = .ready
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    private func apply(_ loaded: TripsReplayRecord) {
        record = loaded
        let merged = TripsReplayDerivations.mergedPositions(loaded)
        positions = merged
        offsets = TripsReplayDerivations.timelineOffsets(merged)
        totalTimeMs = offsets.last ?? 0
        markers = TripsReplayDerivations.markers(merged)
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

    /// Seeks to a position index (web `seekTo`) — the shared chart/scrubber seek channel.
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
        setIndex(TripsReplayDerivations.indexAtTime(offsets, target))
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
        elapsedMs += TripsReplayModel.tickMs * Double(speed.multiplier)
        if elapsedMs >= totalTimeMs {
            elapsedMs = totalTimeMs
            setIndex(offsets.count - 1)
            pause()
            return
        }
        setIndex(TripsReplayDerivations.indexAtTime(offsets, elapsedMs))
    }

    private func setIndex(_ index: Int) {
        if currentIndex != index { currentIndex = index }
        progressFraction = totalTimeMs > 0 ? min(1, elapsedMs / totalTimeMs) : 0
    }

    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(Int(TripsReplayModel.tickMs)))
                guard let self, self.isPlaying else { break }
                self.tick()
            }
        }
    }
}
