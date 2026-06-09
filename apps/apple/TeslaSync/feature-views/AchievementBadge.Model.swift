//
//  AchievementBadge.Model.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the achievement badge. The view binds through `AchievementBadgeModel`;
//  no networking lives in the view. The web source (AchievementBadge.tsx) is a pure
//  presentational leaf fed an `achievement` (and a `size`) prop by its parent
//  (the Lifetime Stats page / the achievement grid), so the input snapshot here
//  carries that achievement plus the parent's loading / error / connectivity state
//  rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (unlocked vs locked, the
//  near-complete pulse, the progress ring). On top of those, this surface honours the
//  P4 leaf contract (the same one AcDcStatsPanel/0096 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol AchievementBadgeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogAchievementBadgeTelemetry: AchievementBadgeTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// freshness chip. `live` hides the chip; `stale` / `offline` show it.
public enum AchievementBadgeConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the parent surface)

/// One coalesced snapshot of the badge's inputs — the native mirror of the web props
/// (`achievement`, `size`) plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity). The achievement's `progress` is a unit-free 0...1
/// fraction carried verbatim from upstream, so no SI conversion applies at this layer.
public struct AchievementBadgeInput: Sendable, Equatable {
    public var achievement: AchievementBadgeData?
    public var size: AchievementBadgeSize
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: AchievementBadgeConnection

    public init(
        achievement: AchievementBadgeData? = nil,
        size: AchievementBadgeSize = .md,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: AchievementBadgeConnection = .live
    ) {
        self.achievement = achievement
        self.size = size
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the badge's render branches.
/// `phase` selects the body; for the data phase the unlocked flag, the rounded
/// percentage, the near-complete flag, and the clamped ring fraction are pre-computed
/// so the view is a pure function of this value.
public struct AchievementBadgeResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let achievement: AchievementBadgeData?
    public let size: AchievementBadgeSize
    public let unlocked: Bool
    public let isNearComplete: Bool
    public let percent: Int
    public let ringFraction: Double

    public init(
        phase: Phase,
        achievement: AchievementBadgeData?,
        size: AchievementBadgeSize,
        unlocked: Bool,
        isNearComplete: Bool,
        percent: Int,
        ringFraction: Double
    ) {
        self.phase = phase
        self.achievement = achievement
        self.size = size
        self.unlocked = unlocked
        self.isNearComplete = isNearComplete
        self.percent = percent
        self.ringFraction = ringFraction
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's derived values plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and the unlocked / near-complete branches.
public enum AchievementBadgeProjection {
    public static func resolve(_ input: AchievementBadgeInput) -> AchievementBadgeResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return base(.error(message), input: input)
        }
        // Initial fetch (web parent `isLoading`).
        if input.isLoading {
            return base(.loading, input: input)
        }
        // Resolved with no achievement → friendly empty state (never a blank box).
        guard let achievement = input.achievement else {
            return base(.empty, input: input)
        }
        return AchievementBadgeResolved(
            phase: .data,
            achievement: achievement,
            size: input.size,
            unlocked: achievement.unlocked,
            isNearComplete: AchievementBadgeMetrics.isNearComplete(
                unlocked: achievement.unlocked,
                progress: achievement.progress
            ),
            percent: AchievementBadgeMetrics.percentInt(progress: achievement.progress),
            ringFraction: AchievementBadgeMetrics.ringFraction(progress: achievement.progress)
        )
    }

    private static func base(
        _ phase: AchievementBadgeResolved.Phase,
        input: AchievementBadgeInput
    ) -> AchievementBadgeResolved {
        AchievementBadgeResolved(
            phase: phase,
            achievement: input.achievement,
            size: input.size,
            unlocked: input.achievement?.unlocked ?? false,
            isNearComplete: false,
            percent: 0,
            ringFraction: 0
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// parent surface's resolved achievement query; previews and tests use
/// `InMemoryAchievementBadgeSource`. The view never talks to the network directly.
@MainActor
public protocol AchievementBadgeSource: AnyObject {
    var onUpdate: (@MainActor (AchievementBadgeInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The badge's observable view-model. Subscribes to an `AchievementBadgeSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class AchievementBadgeModel {
    public private(set) var resolved: AchievementBadgeResolved =
        AchievementBadgeProjection.resolve(AchievementBadgeInput(isLoading: true))
    public private(set) var connection: AchievementBadgeConnection = .live

    public var phase: AchievementBadgeResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any AchievementBadgeSource
    @ObservationIgnored private let telemetry: any AchievementBadgeTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any AchievementBadgeSource,
        telemetry: any AchievementBadgeTelemetry = OSLogAchievementBadgeTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AchievementBadge.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (freshness chip + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: AchievementBadgeInput) {
        resolved = AchievementBadgeProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryAchievementBadgeSource: AchievementBadgeSource {
    public var onUpdate: (@MainActor (AchievementBadgeInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AchievementBadgeInput?

    public init(initial: AchievementBadgeInput? = nil) {
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
    public func push(_ input: AchievementBadgeInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "AchievementBadge" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum AchievementBadgeStrings {
    public static let table = "AchievementBadge"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
