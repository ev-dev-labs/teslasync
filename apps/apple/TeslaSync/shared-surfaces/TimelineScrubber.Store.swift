//
//  TimelineScrubber.Store.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The surface's `@Observable` state-holder (P1/S8). It subscribes to a `TimelineScrubberSource`,
//  projects each snapshot to the resolved view-state, emits `view.opened` exactly once on first
//  appear (P1/S11), and auto-refreshes once on the stale transition. Every seek intent (click, drag,
//  throttled drag emit, marker tap, VoiceOver adjust) funnels through `seek(_:)` onto the host's
//  `onSeek` callback — the track is controlled, exactly like the web source: it never owns the
//  progress, it asks the host to move and re-renders from the next snapshot.
//

import Foundation
import Observation

@MainActor
@Observable
public final class TimelineScrubberModel {
    public private(set) var resolved: TimelineScrubberResolved
    public private(set) var connection: TimelineScrubberConnection = .live

    public var phase: TimelineScrubberResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any TimelineScrubberSource
    @ObservationIgnored private let actions: TimelineScrubberActions
    @ObservationIgnored private let telemetry: any TimelineScrubberTelemetry

    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TimelineScrubberSource,
        actions: TimelineScrubberActions = TimelineScrubberActions(),
        telemetry: any TimelineScrubberTelemetry = OSLogTimelineScrubberTelemetry()
    ) {
        self.source = source
        self.actions = actions
        self.telemetry = telemetry
        resolved = TimelineScrubberResolved.chrome(phase: .loading)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    // MARK: - Lifecycle

    /// Begins observing and emits `view.opened` once (P1/S11).
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: TimelineScrubberMeta.surfaceSlug)
        }
        source.start()
    }

    /// Stops observing. Safe to call repeatedly.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the host snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: TimelineScrubberInput) {
        connection = input.connection
        resolved = TimelineScrubberProjection.resolve(input)
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded refresh on the transition; reset once live so a later stale episode
    /// re-triggers exactly once. Offline never auto-refreshes (cached timeline stays shown).
    private func handleAutoRefresh(for connection: TimelineScrubberConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }

    // MARK: - Seek intent (web `onSeek`)

    /// Reports a normalized seek to the host (clamped 0…1). The single funnel for click, drag, the
    /// throttled intermediate drag emits, marker taps, and VoiceOver adjustments.
    public func seek(_ progress: Double) {
        actions.onSeek(TimelineScrubberAdapter.clamp01(progress))
    }
}
