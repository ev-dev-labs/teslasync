//
//  VersionSegment.Seams.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The infrastructure dependency seams the VersionSegment view-model binds through, kept apart from the
//  network probes (VersionSegment.Probes.swift) and the production polling source
//  (VersionSegment.Polling.swift) for the SwiftLint file-length budget: the P1/S8 source protocol with
//  its in-memory preview/test double, the changelog observer seam (the native peer of the web
//  `useChangelog` unseen-count subscription) with an in-memory double, the poll clock
//  (``VersionSegmentPoller`` — the native peer of the web `useQuery` `refetchInterval`) with a manual
//  test double, and the build-info provider (the native peer of the web `VITE_APP_VERSION` /
//  `VITE_GIT_SHA` module constants). The view never reads any feed directly.
//

import Foundation

// MARK: - Source protocol (P1/S8 seam)

/// The seam the view-model binds through — the native peer of the web component's combined `useQuery` +
/// `useChangelog` inputs, coalesced into one snapshot stream. The production app implements it over the
/// polling source (``PollingVersionSegmentSource``); previews and tests use
/// ``InMemoryVersionSegmentSource``. The view never reads the feeds directly.
@MainActor
public protocol VersionSegmentSource: AnyObject {
    var onUpdate: (@MainActor (VersionSegmentSnapshot) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`, so the model can be driven through every phase and
/// connectivity transition with no network and no real time.
@MainActor
public final class InMemoryVersionSegmentSource: VersionSegmentSource {
    public var onUpdate: (@MainActor (VersionSegmentSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VersionSegmentSnapshot?

    public init(initial: VersionSegmentSnapshot? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ snapshot: VersionSegmentSnapshot) {
        onUpdate?(snapshot)
    }
}

// MARK: - Changelog observer seam (web `useChangelog` unseen count)

/// The seam that emits the unseen changelog count — the native peer of the web `useChangelog` hook's
/// `newEntries.length` (derived from the generated changelog catalog vs the user's last-seen version).
/// The polling source subscribes so the segment's cyan "unseen" dot + the tooltip hint stay live. The
/// production observer recomputes from the host's catalog + seen-store; previews/tests use
/// ``InMemoryChangelogObserver``.
@MainActor
public protocol VersionSegmentChangelogObserver: AnyObject {
    var onUnseenCountChange: (@MainActor (Int) -> Void)? { get set }
    var unseenCount: Int { get }
    func start()
    func stop()
}

/// In-memory changelog observer for previews + tests. Seeds an initial unseen count on `start()` and
/// lets a test push further counts via `push(_:)`, with no storage and no notifications.
@MainActor
public final class InMemoryChangelogObserver: VersionSegmentChangelogObserver {
    public var onUnseenCountChange: (@MainActor (Int) -> Void)?
    public private(set) var unseenCount: Int
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    public init(unseenCount: Int = 0) {
        self.unseenCount = unseenCount
    }

    public func start() {
        startCount += 1
        onUnseenCountChange?(unseenCount)
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a new unseen count to the bound model (test/preview affordance).
    public func push(_ count: Int) {
        unseenCount = count
        onUnseenCountChange?(count)
    }
}

// MARK: - Poll clock seam (web `useQuery` refetchInterval)

/// The poll clock the source re-probes on — the native seam for the web `useQuery({ refetchInterval })`.
/// The production app uses ``TimerVersionSegmentPoller`` (one instance per cadence — 60s for the version,
/// 1h for the update check); tests inject ``ManualVersionSegmentPoller`` to fire each cadence
/// deterministically without real time.
@MainActor
public protocol VersionSegmentPoller: AnyObject {
    /// Begins firing `onTick` every `interval` seconds. Replaces any running schedule.
    func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void)
    /// Halts the schedule. Idempotent — safe to call when not running.
    func stop()
}

/// Manual poller for tests/previews — records the schedule and fires on demand via `fire()`, so each
/// poll cadence can be advanced tick-by-tick with no real time elapsing.
@MainActor
public final class ManualVersionSegmentPoller: VersionSegmentPoller {
    public private(set) var isRunning = false
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var interval: TimeInterval = 0

    private var onTick: (@MainActor () -> Void)?

    public init() {}

    public func start(interval: TimeInterval, onTick: @escaping @MainActor () -> Void) {
        self.interval = interval
        self.onTick = onTick
        isRunning = true
        startCount += 1
    }

    public func stop() {
        if isRunning {
            stopCount += 1
        }
        isRunning = false
        onTick = nil
    }

    /// Fires the scheduled tick once (no-op when stopped).
    public func fire() {
        onTick?()
    }
}

// MARK: - Build-info provider (web `VITE_APP_VERSION` / `VITE_GIT_SHA`)

/// Resolves the build-time provenance — the native peer of the web module constants
/// `BUILD_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'` and
/// `BUILD_SHA = import.meta.env.VITE_GIT_SHA || 'dev'`. Reads the app bundle's
/// `CFBundleShortVersionString` for the version and a baked Info.plist key for the short SHA, applying
/// the same `'dev'` worst-case fallback so a normal build always resolves a version.
public enum VersionSegmentBuildInfoProvider {
    /// The Info.plist key the build pipeline bakes the `git rev-parse --short HEAD` into (the native peer
    /// of the web build-time `VITE_GIT_SHA`).
    public static let gitSHAInfoKey = "TeslaSyncGitSHA"

    /// Reads the build info from a bundle (defaults to `.main`), with the web `'dev'` fallback on each
    /// field so the segment always resolves a version + SHA exactly as the web constants do.
    public static func bundle(_ bundle: Bundle = .main) -> VersionSegmentBuildInfo {
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let sha = bundle.object(forInfoDictionaryKey: gitSHAInfoKey) as? String
        return VersionSegmentBuildInfo(
            buildVersion: VersionSegmentProjection.nonEmpty(version) ?? VersionSegmentSurface.devSentinel,
            buildSHA: VersionSegmentProjection.nonEmpty(sha) ?? VersionSegmentSurface.devSentinel
        )
    }
}
