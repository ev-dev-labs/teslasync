//
//  NewVersionBanner.Polling.swift
//  TeslaSync — P4 shared surface · 0129 · NewVersionBanner (Apple)
//
//  The production version-watcher source — the native peer of the web `useVersionWatcher` hook. It
//  captures the boot baseline on the first successful probe, re-probes `/system/version` on the poll
//  cadence (web `setInterval`, 5 min), and emits a ``NewVersionWatcherSnapshot`` after each probe so the
//  bound model derives availability exactly as the web hook does. Failure semantics follow the web
//  hook's "swallow + retry" behaviour, refined for the P4 leaf freshness axis: a boot-probe failure
//  with no baseline surfaces as an error; a post-baseline poll failure keeps the cached versions and
//  moves the freshness to stale (or offline when the cause was a lost connection).
//
//  Cross-tab parity note: the web hook also mirrors a discovered version across same-origin tabs via a
//  `BroadcastChannel`, explicitly described there as an optimization that degrades gracefully — "every
//  tab still discovers the new version on its own poll cycle". A native app is single-process, so there
//  is no equivalent multi-tab race to coordinate; the poll cadence (the web's own fallback) is the
//  source of truth, and a host that mounts the banner in several scenes shares one source rather than
//  introducing a global broadcast singleton. No behaviour is lost — only the web-only optimization.
//

import Foundation

// MARK: - Production timer poller (web `setInterval`)

/// Production poller backed by a repeating `Timer` on the main run loop — fires the source's re-probe
/// once per `interval` (web `setInterval(tick, POLL_INTERVAL_MS)`).
@MainActor
public final class TimerNewVersionPoller: NewVersionPoller {
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

// MARK: - Polling source (web `useVersionWatcher`)

/// The production source. Probes `/system/version` through the injected ``VersionProbe`` (no networking
/// lives here), captures the boot baseline on the first success, re-probes on the poll cadence, and
/// emits a ``NewVersionWatcherSnapshot`` after each probe. The orchestration mirrors the web hook: a
/// one-time boot probe, then a periodic poll that updates `latestVersion` and lets the bound model
/// compute `latest != boot`.
@MainActor
public final class PollingNewVersionBannerSource: NewVersionBannerSource {
    public var onUpdate: (@MainActor (NewVersionWatcherSnapshot) -> Void)?

    private let probe: any VersionProbe
    private let poller: any NewVersionPoller
    private let interval: TimeInterval

    private var bootVersion: String?
    private var latestVersion: String?
    private var connection: NewVersionConnection = .live
    private var probeTask: Task<Void, Never>?

    public init(
        probe: any VersionProbe,
        poller: any NewVersionPoller = TimerNewVersionPoller(),
        interval: TimeInterval = NewVersionBannerSurface.pollInterval
    ) {
        self.probe = probe
        self.poller = poller
        self.interval = interval
    }

    public func start() {
        // Emit the loading snapshot immediately (web `bootVersion == null`), then run the boot probe.
        if bootVersion == nil {
            onUpdate?(NewVersionWatcherSnapshot(isLoading: true))
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

    /// Runs exactly one probe cycle and emits the resulting snapshot. Exposed so tests can drive the
    /// orchestration deterministically (`await source.probeOnce()`) without a real timer.
    public func probeOnce() async {
        let outcome = await probe.probe()
        apply(outcome)
    }

    private func scheduleProbe() {
        probeTask?.cancel()
        probeTask = Task { [weak self] in
            await self?.probeOnce()
        }
    }

    private func apply(_ outcome: NewVersionProbeOutcome) {
        switch outcome {
        case let .version(version):
            connection = .live
            if bootVersion == nil {
                bootVersion = version
            }
            latestVersion = version
            emit(errorMessage: nil)
        case let .failed(message, offline):
            apply(failure: message, offline: offline)
        }
    }

    private func apply(failure message: String, offline: Bool) {
        if bootVersion == nil {
            // Boot probe failed with nothing cached — surface as the error state (web swallows to null).
            connection = offline ? .offline : .live
            emit(errorMessage: message)
            return
        }
        // Post-baseline poll failed — keep the cached versions, move the freshness axis (web swallows).
        connection = offline ? .offline : .stale
        emit(errorMessage: nil)
    }

    private func emit(errorMessage: String?) {
        onUpdate?(NewVersionWatcherSnapshot(
            bootVersion: bootVersion,
            latestVersion: latestVersion,
            isLoading: false,
            errorMessage: errorMessage,
            connection: connection
        ))
    }
}
