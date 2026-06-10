//
//  StateTimeline.Model.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  i18n facade (P1/S10) + telemetry seam (P1/S11) + the observable state holder for
//  the FSM transition timeline. The view binds through `StateTimelineModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/system/components/state-machine/StateTimeline.tsx — the horizontal rail of
//  FSM transition ticks with selection + an actionable empty state. Foundation /
//  Observation only (no SwiftUI) so the holder is pure-testable.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "StateTimeline" table (the
/// per-surface `.strings`), folded into the app `Localizable.xcstrings` catalog at
/// integration time; the per-surface table keeps each parallel surface prompt
/// self-contained.
public enum StateTimelineStrings {
    public static let table = "StateTimeline"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol StateTimelineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogStateTimelineTelemetry: StateTimelineTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `StateTimelineSource`,
/// projects each snapshot into the placed ticks + window bounds (web `useMemo`),
/// exposes a render `StateTimelinePhase` + freshness for SwiftUI to switch over, owns
/// the selection + the widen-window / jump-to-last empty-state intents, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class StateTimelineModel {
    public private(set) var phase: StateTimelinePhase = .loading
    public private(set) var connection: StateTimelineConnection = .live
    public private(set) var projection = StateTimelineProjection(
        ticks: [],
        windowStart: Date(timeIntervalSince1970: 0),
        windowEnd: Date(timeIntervalSince1970: 0),
        windowMinutes: 10
    )
    public private(set) var selectedID: Int?
    public private(set) var lastTransition: StateTransitionInput?
    public private(set) var widerPreset: Int?
    public private(set) var capabilities = StateTimelineCapabilities()
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any StateTimelineSource
    @ObservationIgnored private let telemetry: any StateTimelineTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let timeZone: TimeZone
    @ObservationIgnored private let now: @MainActor () -> Date
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any StateTimelineSource,
        telemetry: any StateTimelineTelemetry = OSLogStateTimelineTelemetry(),
        locale: Locale = .current,
        timeZone: TimeZone = .current,
        now: @escaping @MainActor () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.timeZone = timeZone
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The localizer the view-model + copy helpers resolve through (P1/S10 facade).
    private var localize: (String, String) -> String {
        StateTimelineStrings.string
    }

    /// The locale used for date / number formatting (header / hint / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The placed ticks (web `ticks`).
    public var ticks: [StateTimelineTick] {
        projection.ticks
    }

    /// The highlighted tick (web `tr.id === selectedId`), or `nil`.
    public var selectedTick: StateTimelineTick? {
        StateTimelineProjector.tick(withID: selectedID, in: projection.ticks)
    }

    /// One tick's tooltip (web `content={`${from} → ${to} · ${formatTime(ts)}`}`).
    public func tooltip(for tick: StateTimelineTick) -> String {
        StateTimelineAccessibility.tooltip(
            from: tick.fromState,
            to: tick.toState,
            timeLabel: StateTimelineFormat.clock(tick.timestamp, locale: locale, timeZone: timeZone)
        )
    }

    /// One tick's VoiceOver label (web `aria-label` = `t('debugger.timeline.tickAria', …)`),
    /// with the clock time appended for context.
    public func tickAccessibilityLabel(for tick: StateTimelineTick) -> String {
        StateTimelineAccessibility.tickLabel(
            from: tick.fromState,
            to: tick.toState,
            timeLabel: StateTimelineFormat.clock(tick.timestamp, locale: locale, timeZone: timeZone),
            localize: localize
        )
    }

    /// The rail-header left label (web `formatTime(start)`).
    public var startLabel: String {
        StateTimelineFormat.clock(projection.windowStart, locale: locale, timeZone: timeZone)
    }

    /// The rail-header right label (web `formatTime(end)`).
    public var endLabel: String {
        StateTimelineFormat.clock(projection.windowEnd, locale: locale, timeZone: timeZone)
    }

    /// The rail-header center label (web `t('debugger.timeline.windowLabel', …)`).
    public var windowLabelText: String {
        StateTimelineFormat.windowLabel(minutes: projection.windowMinutes, localize: localize, locale: locale)
    }

    /// The empty-state message (web `t('debugger.timeline.empty', 'No transitions in window')`).
    public var emptyMessage: String {
        localize("debugger.timeline.empty", "No transitions in window")
    }

    /// Whether the empty-state hint is shown (web `hasHint = Boolean(lastTransition)`).
    public var hasHint: Bool {
        lastTransition != nil
    }

    /// Whether the "Widen window to …" button is shown (web `showWiden = widerPreset !=
    /// null && onWidenWindow != null`).
    public var showWiden: Bool {
        widerPreset != nil && capabilities.widenWindow
    }

    /// Whether the "Jump to last transition" button is shown (web `showJump =
    /// lastTransition != null && onJumpToLast != null`).
    public var showJump: Bool {
        lastTransition != nil && capabilities.jumpToLast
    }

    /// The "Last transition {{rel}}" hint (web `t('debugger.timeline.lastSeen', …)`), or
    /// `nil` when there is no most-recent transition.
    public var lastSeenLabel: String? {
        guard let lastTransition else { return nil }
        let rel = StateTimelineFormat.relative(
            lastTransition.timestamp,
            now: now(),
            localize: localize,
            locale: locale,
            timeZone: timeZone
        )
        return String(format: localize("debugger.timeline.lastSeen", "Last transition %@"), rel)
    }

    /// The "Widen window to {{label}}" button title (web `t('debugger.timeline.widenTo',
    /// …, { label: presetLabel(widerPreset) })`), or `nil` when no preset fits.
    public var widenLabel: String? {
        guard let widerPreset else { return nil }
        let preset = StateTimelineFormat.presetLabel(minutes: widerPreset, localize: localize, locale: locale)
        return String(format: localize("debugger.timeline.widenTo", "Widen window to %@"), preset)
    }

    /// The "Jump to last transition" button title (web `t('debugger.timeline.jumpToLast', …)`).
    public var jumpLabel: String {
        localize("debugger.timeline.jumpToLast", "Jump to last transition")
    }

    /// The combined VoiceOver summary for the surface across every phase.
    public var accessibilitySummary: String {
        let title = localize("debugger.timeline.title", "State transition timeline")
        switch phase {
        case .loading:
            return "\(title): \(localize("debugger.timeline.loading", "Loading transitions"))"
        case let .error(message):
            let errorTitle = localize("debugger.timeline.errorTitle", "Couldn't load transitions")
            return message.isEmpty ? "\(title): \(errorTitle)" : "\(title): \(errorTitle), \(message)"
        case .empty:
            return StateTimelineAccessibility.emptySummary(
                message: emptyMessage,
                lastSeen: lastSeenLabel,
                localize: localize
            )
        case .content:
            return StateTimelineAccessibility.railSummary(
                ticksCount: projection.ticks.count,
                windowMinutes: projection.windowMinutes,
                startLabel: startLabel,
                endLabel: endLabel,
                localize: localize,
                locale: locale
            )
        }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: StateTimelineSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    /// Selects a tick (web `onSelect(tr)`), optimistically highlighting it before
    /// notifying the source (the parent owns the authoritative `selectedId`).
    public func select(_ tick: StateTimelineTick) {
        selectedID = tick.id
        source.select(tick.id)
    }

    /// Snaps the toolbar window to the wider preset (web `onWidenWindow`). No-op when
    /// the parent did not supply the intent (web optional `onWidenWindow`).
    public func widenWindow() {
        guard showWiden else { return }
        source.widenWindow()
    }

    /// Freezes + selects the last transition (web `onJumpToLast`). No-op when the
    /// parent did not supply the intent (web optional `onJumpToLast`).
    public func jumpToLast() {
        guard showJump else { return }
        source.jumpToLast()
    }

    // MARK: - Snapshot application

    private func apply(_ update: StateTimelineUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        selectedID = update.selectedID
        lastTransition = update.lastTransition
        widerPreset = update.widerPreset
        capabilities = update.capabilities
        projection = StateTimelineProjector.project(
            transitions: update.transitions,
            fsmType: update.fsmType,
            windowMinutes: update.windowMinutes,
            anchor: update.anchor ?? now()
        )
        phase = StateTimelineProjector.resolvePhase(
            update.status,
            hasTicks: StateTimelineProjector.hasTicks(projection.ticks)
        )
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached timeline on screen and does not refetch.
    private func handleAutoRefresh(for connection: StateTimelineConnection) {
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
}

// MARK: - Surface identity

public extension StateTimeline {
    /// Diagnostics surface slug (P1/S11 `view.opened`). `nonisolated` so it is
    /// reachable off the main actor (SwiftUI `View` is `@MainActor` by default).
    nonisolated static var surfaceSlug: String {
        StateTimelineSurface.slug
    }
}
