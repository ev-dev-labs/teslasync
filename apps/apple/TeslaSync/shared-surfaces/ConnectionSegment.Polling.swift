//
//  ConnectionSegment.Polling.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The production source — the native peer of the web `useApiHealth` `useQuery`. It probes `/healthz` on
//  the 15s cadence (through the injected probe — no networking lives here), buckets each reading into a
//  status (web `bucket`), and emits a ``ConnectionSegmentSnapshot`` after each probe so the bound model
//  derives the segment exactly as the web hook does. A `connecting` snapshot is emitted up front so a
//  freshly-mounted segment shows the muted "Connecting…" chip until the first probe lands (the web `!data`
//  return). Failure semantics follow the web: a failed probe is reported as `ok: false`, which buckets to
//  `offline` — the source does not retry-suppress or swallow (web `retry: false`).
//

import Foundation

// MARK: - Production timer poller (web `useQuery` refetchInterval)

/// Production poller backed by a repeating `Timer` on the main run loop — fires the source's re-probe once
/// per `interval` (web `useQuery({ refetchInterval: 15_000 })`). The web hook sets
/// `refetchIntervalInBackground: false`, so a host pauses the segment (calling `stop()`) when it leaves the
/// foreground; this poller stops cleanly and the cached reading ages to `stale` until the next `start()`.
@MainActor
public final class TimerConnectionSegmentPoller: ConnectionSegmentPoller {
    private nonisolated(unsafe) var timer: Timer?

    public init() {}

    public func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void) {
        stop()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { _ in
            MainActor.assumeIsolated {
                onTick()
            }
        }
    }

    public func stop() {
        timer?.invalidate()
        timer = nil
    }

    deinit {
        timer?.invalidate()
    }
}

// MARK: - Polling source (web `useApiHealth` useQuery)

/// The production source. Probes `/healthz` through the injected probe on the injected poll clock, buckets
/// each reading, and emits a coalesced ``ConnectionSegmentSnapshot``. The orchestration mirrors the web
/// hook: a `connecting` snapshot up front (the `!data` return), an immediate first probe + the 15s repeat
/// cadence (`refetchInterval`), and each reading mapped through `bucket` into `online` / `degraded` /
/// `offline`. No retry suppression (web `retry: false`) — a failed probe surfaces as `offline` directly.
@MainActor
public final class PollingConnectionSegmentSource: ConnectionSegmentSource {
    public var onUpdate: (@MainActor (ConnectionSegmentSnapshot) -> Void)?

    private let probe: any ConnectionHealthProbe
    private let poller: any ConnectionSegmentPoller
    private let interval: TimeInterval
    private var resolvedOnce = false
    private var probeTask: Task<Void, Never>?

    public init(
        probe: any ConnectionHealthProbe,
        poller: any ConnectionSegmentPoller = TimerConnectionSegmentPoller(),
        interval: TimeInterval = ConnectionSegmentSurface.pollIntervalSeconds
    ) {
        self.probe = probe
        self.poller = poller
        self.interval = interval
    }

    public func start() {
        if !resolvedOnce {
            onUpdate?(.initial)
        }
        scheduleProbe()
        poller.start(interval: interval) { [weak self] in self?.scheduleProbe() }
    }

    public func stop() {
        probeTask?.cancel()
        probeTask = nil
        poller.stop()
    }

    public func refresh() {
        scheduleProbe()
    }

    /// Runs one probe cycle and emits the bucketed snapshot. Exposed so tests drive the orchestration
    /// deterministically without real time.
    public func probeOnce() async {
        let result = await probe.probe()
        resolvedOnce = true
        onUpdate?(.make(from: result))
    }

    private func scheduleProbe() {
        probeTask?.cancel()
        probeTask = Task { [weak self] in await self?.probeOnce() }
    }
}
