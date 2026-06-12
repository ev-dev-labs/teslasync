//
//  VersionSegment.Polling.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The production source — the native peer of the web component's two `useQuery` hooks + `useChangelog`,
//  coalesced into one snapshot stream. It probes `/system/version` on the 60s cadence and
//  `/system/update-check` on the 1h cadence (through the injected probes — no networking lives here),
//  observes the unseen changelog count, and emits a ``VersionSegmentSnapshot`` after each change so the
//  bound model derives the segment + modal exactly as the web component does. Failure semantics follow
//  the web's "swallow + retry" behaviour, refined for the P4 leaf freshness axis: a first version probe
//  with no baseline surfaces as the loading/error leaf; a later version-poll failure keeps the cached
//  value and moves the freshness to stale (or offline); an update-check failure is non-fatal (the web
//  still renders the version), so the last result is retained.
//

import Foundation

// MARK: - Production timer poller (web `useQuery` refetchInterval)

/// Production poller backed by a repeating `Timer` on the main run loop — fires the source's re-probe
/// once per `interval` (web `useQuery({ refetchInterval })`). One instance drives the version cadence
/// (60s) and a second drives the update-check cadence (1h).
@MainActor
public final class TimerVersionSegmentPoller: VersionSegmentPoller {
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

// MARK: - Production changelog observer (web `useChangelog` external store)

/// Production changelog observer — recomputes the unseen count from the host's `countProvider` (which
/// reads the generated changelog catalog vs the user's last-seen version) and re-reads it whenever one of
/// the `refreshOn` notifications fires (default: the changelog-opened broadcast). The native peer of the
/// web `useChangelog`'s `useSyncExternalStore` re-reading on storage events.
@MainActor
public final class NotificationChangelogObserver: VersionSegmentChangelogObserver {
    public var onUnseenCountChange: (@MainActor (Int) -> Void)?
    public private(set) var unseenCount = 0

    private let countProvider: @Sendable () -> Int
    private let center: NotificationCenter
    private let names: [Notification.Name]
    private var tokens: [NSObjectProtocol] = []

    public init(
        countProvider: @escaping @Sendable () -> Int,
        center: NotificationCenter = .default,
        refreshOn names: [Notification.Name] = [VersionSegmentSurface.openChangelogNotification]
    ) {
        self.countProvider = countProvider
        self.center = center
        self.names = names
    }

    public func start() {
        recompute()
        for name in names {
            let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.recompute()
                }
            }
            tokens.append(token)
        }
    }

    public func stop() {
        for token in tokens {
            center.removeObserver(token)
        }
        tokens.removeAll()
    }

    private func recompute() {
        unseenCount = max(0, countProvider())
        onUnseenCountChange?(unseenCount)
    }
}

// MARK: - Polling source (web two `useQuery` + `useChangelog`)

/// The production source. Probes both endpoints through the injected probes, observes the unseen
/// changelog count, and emits a coalesced ``VersionSegmentSnapshot`` after each change. The orchestration
/// mirrors the web component: independent version (60s) + update-check (1h) cadences, the version probe
/// driving the freshness axis, the update-check failure swallowed, and the changelog count kept live.
@MainActor
public final class PollingVersionSegmentSource: VersionSegmentSource {
    public var onUpdate: (@MainActor (VersionSegmentSnapshot) -> Void)?

    private let versionProbe: any VersionInfoProbe
    private let updateProbe: any UpdateCheckProbe
    private let changelog: any VersionSegmentChangelogObserver
    private let versionPoller: any VersionSegmentPoller
    private let updatePoller: any VersionSegmentPoller
    private let versionInterval: TimeInterval
    private let updateInterval: TimeInterval

    private var versionInfo: VersionInfo?
    private var updateCheck: UpdateCheckResult?
    private var unseenCount = 0
    private var connection: VersionSegmentConnection = .live
    private var versionResolvedOnce = false
    private var hasVersionBaseline = false
    private var lastErrorMessage: String?
    private var versionTask: Task<Void, Never>?
    private var updateTask: Task<Void, Never>?

    public init(
        versionProbe: any VersionInfoProbe,
        updateProbe: any UpdateCheckProbe,
        changelog: any VersionSegmentChangelogObserver,
        versionPoller: any VersionSegmentPoller = TimerVersionSegmentPoller(),
        updatePoller: any VersionSegmentPoller = TimerVersionSegmentPoller(),
        versionInterval: TimeInterval = VersionSegmentSurface.versionPollInterval,
        updateInterval: TimeInterval = VersionSegmentSurface.updatePollInterval
    ) {
        self.versionProbe = versionProbe
        self.updateProbe = updateProbe
        self.changelog = changelog
        self.versionPoller = versionPoller
        self.updatePoller = updatePoller
        self.versionInterval = versionInterval
        self.updateInterval = updateInterval
    }

    public func start() {
        if !versionResolvedOnce {
            onUpdate?(VersionSegmentSnapshot(isLoading: true))
        }
        changelog.onUnseenCountChange = { [weak self] count in self?.applyUnseen(count) }
        changelog.start()
        scheduleVersionProbe()
        scheduleUpdateProbe()
        versionPoller.start(interval: versionInterval) { [weak self] in self?.scheduleVersionProbe() }
        updatePoller.start(interval: updateInterval) { [weak self] in self?.scheduleUpdateProbe() }
    }

    public func stop() {
        versionTask?.cancel()
        updateTask?.cancel()
        versionTask = nil
        updateTask = nil
        versionPoller.stop()
        updatePoller.stop()
        changelog.stop()
    }

    public func refresh() {
        scheduleVersionProbe()
        scheduleUpdateProbe()
    }

    /// Runs one version probe cycle and emits. Exposed so tests drive the orchestration deterministically.
    public func probeVersionOnce() async {
        await applyVersion(versionProbe.probe())
    }

    /// Runs one update-check probe cycle and emits. Exposed for deterministic tests.
    public func probeUpdateOnce() async {
        await applyUpdate(updateProbe.probe())
    }

    private func scheduleVersionProbe() {
        versionTask?.cancel()
        versionTask = Task { [weak self] in await self?.probeVersionOnce() }
    }

    private func scheduleUpdateProbe() {
        updateTask?.cancel()
        updateTask = Task { [weak self] in await self?.probeUpdateOnce() }
    }

    private func applyVersion(_ outcome: VersionInfoProbeOutcome) {
        versionResolvedOnce = true
        switch outcome {
        case let .info(info):
            connection = .live
            versionInfo = info
            hasVersionBaseline = true
            lastErrorMessage = nil
        case let .failed(message, offline):
            if hasVersionBaseline {
                // Later poll failed — keep the cached value, move the freshness axis (web swallows).
                connection = offline ? .offline : .stale
            } else {
                // First probe failed with nothing cached — the loading/error leaf (web has the dev build).
                connection = offline ? .offline : .live
                lastErrorMessage = message
            }
        }
        emit()
    }

    private func applyUpdate(_ outcome: UpdateCheckProbeOutcome) {
        // The update check is non-fatal: a failure keeps the last result (web renders the version anyway).
        if case let .result(result) = outcome {
            updateCheck = result
        }
        emit()
    }

    private func applyUnseen(_ count: Int) {
        unseenCount = count
        emit()
    }

    private func emit() {
        onUpdate?(VersionSegmentSnapshot(
            versionInfo: versionInfo,
            updateCheck: updateCheck,
            changelogUnseenCount: unseenCount,
            isLoading: !versionResolvedOnce,
            errorMessage: hasVersionBaseline ? nil : lastErrorMessage,
            connection: connection
        ))
    }
}
