//
//  SummaryStatsRow.Model.swift
//  TeslaSync — P4 feature view · 0048 · SummaryStatsRow (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the security-access summary stats row. The view binds through
//  `SummaryStatsModel`; no networking lives in the view. The web source
//  (SummaryStatsRow.tsx) is a pure presentational leaf fed by its parent
//  (SecurityStatusCards) — so the "source" here carries the parent's prop snapshot
//  (isSecure / lastLockChange / sentryUptime / totalEvents / isLoading) rather than
//  issuing HTTP itself, and the only lifecycle branch the web leaf has is `isLoading`
//  (loading skeletons) vs. the resolved row of four metric cards. Connectivity /
//  empty / stale handling is owned by the parent surface, not duplicated here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol SummaryStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSummaryStatsTelemetry: SummaryStatsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from SecurityStatusCards)

/// One coalesced snapshot of the row's inputs — the native mirror of the web props
/// (`isSecure`, `lastLockChange`, `sentryUptime`, `totalEvents`, `isLoading`). The
/// values are SI/units-free here (a percentage, a count, an ISO instant, two flags),
/// so no unit conversion applies at this layer.
public struct SummaryStatsInput: Sendable, Equatable {
    public var isSecure: Bool
    public var lastLockChange: String?
    public var sentryUptime: Double
    public var totalEvents: Int
    public var isLoading: Bool

    public init(
        isSecure: Bool = false,
        lastLockChange: String? = nil,
        sentryUptime: Double = 0,
        totalEvents: Int = 0,
        isLoading: Bool = false
    ) {
        self.isSecure = isSecure
        self.lastLockChange = lastLockChange
        self.sentryUptime = sentryUptime
        self.totalEvents = totalEvents
        self.isLoading = isLoading
    }
}

/// The resolved, view-ready state — the native mirror of the web component's two
/// render branches (`isLoading` skeletons vs. the four metric cards).
public struct SummaryStatsResolved: Sendable, Equatable {
    /// The mutually-exclusive render branches.
    public enum Phase: Sendable, Equatable {
        case loading
        case data
    }

    public let phase: Phase
    public let tiles: [SummaryStatTile]

    public init(phase: Phase, tiles: [SummaryStatTile]) {
        self.phase = phase
        self.tiles = tiles
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's `if (isLoading) … return <skeletons>; return <four
/// cards>` branch plus the per-card `label` / `value` / `icon` / `color` wiring.
/// Unit tested across both branches and every value variant.
public enum SummaryStatsProjection {
    public static func resolve(
        _ input: SummaryStatsInput,
        now: Date,
        locale: Locale = .current
    ) -> SummaryStatsResolved {
        if input.isLoading {
            return SummaryStatsResolved(phase: .loading, tiles: [])
        }
        let tiles: [SummaryStatTile] = [
            SummaryStatTile(
                id: "status",
                labelKey: "admin.security.stat.status",
                labelFallback: "Current Status",
                value: .secure(input.isSecure),
                accent: input.isSecure ? .secure : .unsecure,
                symbol: "checkmark.shield.fill"
            ),
            SummaryStatTile(
                id: "lastLock",
                labelKey: "admin.security.stat.lastLock",
                labelFallback: "Last Lock Change",
                value: .relative(SummaryStatsFormat.relativeTime(input.lastLockChange, now: now)),
                accent: .lastLock,
                symbol: "clock.fill"
            ),
            SummaryStatTile(
                id: "sentryUptime",
                labelKey: "admin.security.stat.sentryUptime",
                labelFallback: "Sentry Uptime",
                value: .text(SummaryStatsFormat.percent(input.sentryUptime, locale: locale)),
                accent: .uptime,
                symbol: "waveform.path.ecg"
            ),
            SummaryStatTile(
                id: "totalEvents",
                labelKey: "admin.security.stat.totalEvents",
                labelFallback: "Total Events",
                value: .text(SummaryStatsFormat.count(input.totalEvents)),
                accent: .events,
                symbol: "chart.bar.fill"
            )
        ]
        return SummaryStatsResolved(phase: .data, tiles: tiles)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// parent surface's snapshot (the security-access page's resolved security state);
/// previews and tests use `InMemorySummaryStatsSource`. The view never talks to the
/// network directly.
@MainActor
public protocol SummaryStatsSource: AnyObject {
    var onUpdate: (@MainActor (SummaryStatsInput) -> Void)? { get set }
    func start()
    func stop()
}

/// The row's observable view-model. Subscribes to a `SummaryStatsSource`, recomputes
/// the resolved projection, and exposes a render `Phase` plus the resolved tiles for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class SummaryStatsModel {
    public private(set) var phase: SummaryStatsResolved.Phase = .loading
    public private(set) var tiles: [SummaryStatTile] = []

    @ObservationIgnored private let source: any SummaryStatsSource
    @ObservationIgnored private let telemetry: any SummaryStatsTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any SummaryStatsSource,
        telemetry: any SummaryStatsTelemetry = OSLogSummaryStatsTelemetry(),
        locale: Locale = .current,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.clock = clock
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SummaryStatsRow.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    private func apply(_ input: SummaryStatsInput) {
        let resolved = SummaryStatsProjection.resolve(input, now: clock(), locale: locale)
        phase = resolved.phase
        tiles = resolved.tiles
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySummaryStatsSource: SummaryStatsSource {
    public var onUpdate: (@MainActor (SummaryStatsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    private let initial: SummaryStatsInput?

    public init(initial: SummaryStatsInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: SummaryStatsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SummaryStatsRow" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SSRStrings {
    public static let table = "SummaryStatsRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Localises a resolved relative-time bucket (web `timeSince` wording). The
    /// English fallbacks reproduce the web literals ("just now", "Nm ago", …) while
    /// keeping the words out of the Swift sources.
    public static func relativeTime(_ bucket: SummaryRelativeTime) -> String {
        switch bucket {
        case .none:
            SummaryStatsFormat.dash
        case .justNow:
            string("admin.security.relativeTime.justNow", "just now")
        case let .minutes(value):
            String(
                format: string("admin.security.relativeTime.minutes", "%lldm ago"), value
            )
        case let .hours(value):
            String(
                format: string("admin.security.relativeTime.hours", "%lldh ago"), value
            )
        case let .days(value):
            String(
                format: string("admin.security.relativeTime.days", "%lldd ago"), value
            )
        }
    }
}
