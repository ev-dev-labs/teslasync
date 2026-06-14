//
//  RoutePlayback.Model.swift
//  TeslaSync — P4 shared surface · 0187 · RoutePlayback (Apple)
//
//  The `@Observable` state-holder (P1/S8) for the route-playback surface — split from its dependency
//  seams (see `RoutePlayback.Seams.swift`) for the lint length budget. The view binds through
//  `RoutePlaybackModel`; no networking lives in the view. It keeps the web data contract (the host's
//  trip-replay query feeding `<RoutePlayback points=… />`): a source pushes the coalesced rows + load
//  phase + connectivity, the model adapts them through `RoutePlaybackAdapter`, retains the last-known
//  route across an offline snapshot (web cache-then-network), owns the playback clock that advances the
//  cursor (web `setInterval(tick, 50)`), drives the embedded controlled `PlaybackControls` bar (web
//  `<PlaybackControls … />`), emits `view.opened` once, and auto-refreshes once on the stale edge.
//

import Foundation
import Observation

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Binds a `RoutePlaybackSource`, adapts the route snapshot through
/// `RoutePlaybackAdapter`, retains the last-known route across an offline snapshot, owns the playback
/// clock + cursor, drives the embedded controlled `PlaybackControls` bar, exposes the connectivity axis,
/// emits `view.opened` once on first appear, and auto-refreshes once on the stale edge. The resolved
/// view-state + the live frame are projected by `RoutePlaybackProjection`.
@MainActor
@Observable
public final class RoutePlaybackModel {
    public private(set) var connection: RoutePlaybackConnection = .live
    public private(set) var phase: RoutePlaybackLoadPhase = .loading
    public private(set) var route: RoutePlaybackRoute = .empty
    public private(set) var isPlaying = false
    public private(set) var speed: PlaybackControlsSpeed = .x1
    public private(set) var currentIndex = 0
    public private(set) var elapsedMs: Double = 0

    public let content: RoutePlaybackContent

    /// The embedded controlled transport bar's model (web `<PlaybackControls … />`). The view renders
    /// `PlaybackControls(model: controlsModel)`; this model keeps it in sync with the playback clock.
    @ObservationIgnored public let controlsModel: PlaybackControlsModel

    @ObservationIgnored private let source: any RoutePlaybackSource
    @ObservationIgnored private let clock: any RoutePlaybackClock
    @ObservationIgnored private let telemetry: any RoutePlaybackTelemetry
    @ObservationIgnored private let controlsSource: LivePlaybackControlsSource
    @ObservationIgnored private let transport = RoutePlaybackTransport()
    @ObservationIgnored private let onPositionChange: (@MainActor (RoutePlaybackPoint, Int) -> Void)?

    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoPlay = false
    @ObservationIgnored private var lastConnection: RoutePlaybackConnection = .live
    @ObservationIgnored private var lastNotifiedIndex = -1

    public init(
        content: RoutePlaybackContent,
        source: any RoutePlaybackSource,
        clock: any RoutePlaybackClock = TimerRoutePlaybackClock(),
        telemetry: any RoutePlaybackTelemetry = OSLogRoutePlaybackTelemetry(),
        onPositionChange: (@MainActor (RoutePlaybackPoint, Int) -> Void)? = nil
    ) {
        self.content = content
        self.source = source
        self.clock = clock
        self.telemetry = telemetry
        self.onPositionChange = onPositionChange
        controlsSource = LivePlaybackControlsSource(snapshot: PlaybackControlsInput())
        controlsModel = PlaybackControlsModel(
            source: controlsSource,
            actions: transport.makeActions()
        )
        transport.model = self
        source.onUpdate = { [weak self] input in self?.apply(input) }
        clock.onTick = { [weak self] in self?.tick() }
    }

    /// The resolved, view-ready state (the view renders this).
    public var resolved: RoutePlaybackResolved {
        RoutePlaybackProjection.resolve(
            content: content,
            route: route,
            phase: phase,
            connection: connection
        )
    }

    /// The live playhead frame (the map glyph + metric chip render this).
    public var frame: RoutePlaybackFrame {
        RoutePlaybackProjection.frame(
            route: route,
            currentIndex: currentIndex,
            isPlaying: isPlaying,
            speedMultiplier: speed.multiplier,
            elapsedMs: elapsedMs
        )
    }

    // MARK: Lifecycle

    /// Begins observing the source, emits `view.opened` once, and honours auto-play once the initial
    /// route resolves. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        source.start()
        emitOpenOnce()
        autoPlayIfNeeded()
    }

    /// Stops observing the source and halts the clock.
    public func stop() {
        started = false
        clock.stop()
        source.stop()
    }

    /// Re-requests the route (freshness chip + stale / offline recovery → web `refetch`).
    public func refresh() {
        source.refresh()
    }

    // MARK: Transport intents (web `play / pause / stop / seek / cycleSpeed`)

    /// Starts playback — the web `play` (no-op with fewer than two samples; restarts from 0 when parked
    /// at the end).
    public func play() {
        guard route.points.count >= 2 else { return }
        if route.totalMs > 0, elapsedMs >= route.totalMs {
            elapsedMs = 0
            setCurrentIndex(0)
        }
        isPlaying = true
        clock.start()
        publishControls()
    }

    /// Pauses playback — the web `pause`.
    public func pause() {
        isPlaying = false
        clock.stop()
        publishControls()
    }

    /// Stops + rewinds to the start — the web `stop` (Reset / Stop both land here).
    public func stopAndReset() {
        isPlaying = false
        clock.stop()
        elapsedMs = 0
        setCurrentIndex(0)
        publishControls()
    }

    /// Seeks to a normalised 0…1 position — the web `seekToProgress`.
    public func seek(_ progress: Double) {
        let target = max(0, min(1, progress)) * route.totalMs
        elapsedMs = target
        setCurrentIndex(RoutePlaybackTiming.index(at: target, in: route.offsets))
        publishControls()
    }

    /// Sets the replay speed — the web `cycleSpeed` (the bar already constrains to the {1,10,25,50,100}
    /// ladder).
    public func setSpeed(_ next: PlaybackControlsSpeed) {
        speed = next
        publishControls()
    }

    // MARK: Clock

    /// Advances the cursor one tick — the web `tick` (clamp + stop at the end, else seek to the offset).
    func tick() {
        let result = RoutePlaybackTiming.advance(
            elapsed: elapsedMs,
            total: route.totalMs,
            speedMultiplier: speed.multiplier
        )
        elapsedMs = result.elapsed
        if result.reachedEnd {
            setCurrentIndex(max(0, route.points.count - 1))
            isPlaying = false
            clock.stop()
        } else {
            setCurrentIndex(RoutePlaybackTiming.index(at: elapsedMs, in: route.offsets))
        }
        publishControls()
    }

    // MARK: Private

    private func apply(_ input: RoutePlaybackInput) {
        let previous = lastConnection
        connection = input.connection
        lastConnection = input.connection
        phase = input.phase
        // A snapshot carrying rows adapts to a route; a snapshot with no rows retains the last-known
        // route (offline → keep the cached trail).
        if let rows = input.rows {
            route = RoutePlaybackAdapter.route(from: rows)
            clampCursorToRoute()
            notifyPosition(force: true)
        }
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch); offline never
        // auto-refreshes (there is no connection to re-fetch over).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
        autoPlayIfNeeded()
        publishControls()
    }

    /// Clamps the cursor + elapsed clock into the (possibly shorter) new route.
    private func clampCursorToRoute() {
        if currentIndex >= route.count {
            currentIndex = max(0, route.count - 1)
        }
        if elapsedMs > route.totalMs {
            elapsedMs = route.totalMs
        }
    }

    /// Honours the web initial `isPlaying = autoPlay && points.length > 1`, once, after the first
    /// playable route resolves.
    private func autoPlayIfNeeded() {
        guard started, !didAutoPlay, content.autoPlay, route.points.count >= 2 else { return }
        didAutoPlay = true
        play()
    }

    private func setCurrentIndex(_ index: Int) {
        let clamped = route.points.isEmpty ? 0 : max(0, min(route.points.count - 1, index))
        if clamped != currentIndex {
            currentIndex = clamped
        }
        notifyPosition(force: false)
    }

    /// Fires `onPositionChange` when the cursor sample changes — the web effect on `[currentIndex,
    /// points]`. `force` re-emits after a route reload even when the index is unchanged.
    private func notifyPosition(force: Bool) {
        guard let handler = onPositionChange else { return }
        guard force || currentIndex != lastNotifiedIndex else { return }
        guard let point = route.point(at: currentIndex) else { return }
        lastNotifiedIndex = currentIndex
        handler(point, currentIndex)
    }

    /// Mirrors the current playback state into the embedded controlled bar (web re-render of the
    /// controlled `<PlaybackControls>` props). Connectivity is reported `.live` here because the route
    /// surface owns its own freshness chrome over the map.
    private func publishControls() {
        let current = frame
        controlsSource.update(PlaybackControlsInput(
            isPlaying: isPlaying,
            speed: speed,
            progress: current.progress,
            elapsed: current.elapsedLabel,
            total: current.totalLabel,
            durationMs: route.totalMs,
            connection: .live
        ))
    }

    private func emitOpenOnce() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: RoutePlaybackMeta.surfaceSlug)
    }
}
