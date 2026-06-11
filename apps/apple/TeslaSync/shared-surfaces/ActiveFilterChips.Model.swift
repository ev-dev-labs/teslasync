//
//  ActiveFilterChips.Model.swift
//  TeslaSync — P4 shared surface · 0147 · ActiveFilterChips (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the polite-announcement seam (the native parity
//  of the web `<VisuallyHidden liveRegion>`), and the observable state-holder (P1/S8) for the active-filter
//  chip strip. The web `<ActiveFilterChips>` is purely presentational: it takes its data as plain props
//  and renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own
//  is the surface's interaction state (the overflow-popover open flag + the last live-region announcement),
//  the props (the derived ``ActiveFilterChipsProjection`` is an observed read), the per-chip `onRemove` /
//  `onClearAll` closures (kept here so the value types stay closure-free + `Equatable`), and the single
//  `view.opened` diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "ActiveFilterChips" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic.
public enum ActiveFilterChipsStrings {
    public static let table = "ActiveFilterChips"

    public static let string: ActiveFilterChipsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Group container label (web `filters.activeLabel`).
    public static var activeLabel: String {
        string("filters.activeLabel", "Active filters")
    }

    /// "Clear all" affordance (web `filters.clearAll`).
    public static var clearAll: String {
        string("filters.clearAll", "Clear all")
    }

    /// Overflow popover label (web `filters.moreLabel`).
    public static var moreLabel: String {
        string("filters.moreLabel", "Additional active filters")
    }

    /// Friendly empty-group body (native — never a blank box).
    public static var empty: String {
        string("activeFilterChips.empty", "No active filters")
    }

    /// "+N more" overflow trigger (web `filters.moreCount`, with `{{count}}` interpolated).
    public static func moreCount(_ count: Int) -> String {
        ActiveFilterChipsProjector.moreCountLabel(
            template: string("filters.moreCount", "+{{count}} more"),
            count: count
        )
    }

    /// One chip's remove-button label (web `filters.removeAria`, with `{{label}}` interpolated).
    public static func removeAria(label: String) -> String {
        ActiveFilterChipsProjector.removeAccessibilityLabel(
            template: string("filters.removeAria", "Remove filter {{label}}"),
            label: label
        )
    }

    /// The removed-chip announcement (web `filters.removed`), padded for re-announcement.
    public static func removedAnnouncement(label: String, sequence: Int) -> String {
        ActiveFilterChipsProjector.removalAnnouncement(
            removedText: string("filters.removed", "Filter removed"),
            label: label,
            sequence: sequence
        )
    }

    /// The cleared-all announcement (web `filters.clearedAll`), padded for re-announcement.
    public static func clearedAllAnnouncement(sequence: Int) -> String {
        ActiveFilterChipsProjector.clearedAllAnnouncement(
            clearedText: string("filters.clearedAll", "All filters cleared"),
            sequence: sequence
        )
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ActiveFilterChipsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogActiveFilterChipsTelemetry: ActiveFilterChipsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement seam (native parity of the web `<VisuallyHidden liveRegion>`)

/// Posts a polite announcement to the assistive technology — the native boundary that replaces the web
/// component's `aria-live="polite"` visually-hidden region. The view injects
/// ``LiveActiveFilterChipsAnnouncer`` (which posts an `AccessibilityNotification.Announcement`); tests
/// inject a recording double; the model default logs so previews never emit live speech.
@MainActor
public protocol ActiveFilterChipsAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews and headless models run quietly.
@MainActor
public struct OSLogActiveFilterChipsAnnouncer: ActiveFilterChipsAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - ActiveFilterChipsModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``ActiveFilterChipsInput`` (the web props),
/// the overflow-popover open flag, and the last polite announcement string; derives the pure
/// ``ActiveFilterChipsProjection`` as an observed read; routes each chip removal + clear-all through the
/// page-supplied closures (web `descriptor.onRemove` / `onClearAll`) while posting the matching polite
/// announcement (web live region); and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class ActiveFilterChipsModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: ActiveFilterChipsInput

    /// Whether the "+N more" overflow popover is open (web `overflowOpen`).
    public private(set) var overflowOpen = false

    /// The most-recent polite live-region text (web `removalAnnouncement`). Observed so a UI test can read
    /// what VoiceOver was asked to speak; the real voicing happens through the announcer seam.
    public private(set) var announcement = ""

    @ObservationIgnored private var removeHandlers: [String: @MainActor () -> Void]
    @ObservationIgnored private var onClearAll: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any ActiveFilterChipsTelemetry
    @ObservationIgnored private let announcer: any ActiveFilterChipsAnnouncer
    @ObservationIgnored private var announceCounter = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: ActiveFilterChipsInput,
        removeHandlers: [String: @MainActor () -> Void] = [:],
        onClearAll: (@MainActor () -> Void)? = nil,
        telemetry: any ActiveFilterChipsTelemetry = OSLogActiveFilterChipsTelemetry(),
        announcer: any ActiveFilterChipsAnnouncer = OSLogActiveFilterChipsAnnouncer()
    ) {
        self.input = input
        self.removeHandlers = removeHandlers
        self.onClearAll = onClearAll
        self.telemetry = telemetry
        self.announcer = announcer
    }

    /// The resolved, view-ready strip (web render output) — a pure function of the current props.
    public var projection: ActiveFilterChipsProjection {
        ActiveFilterChipsProjector.resolve(input)
    }

    /// Replaces the props + the page closures — the native peer of React re-rendering with new props. The
    /// closures are always refreshed (they are recreated each parent render); the props reassign only when
    /// they actually change so an unrelated re-render does not invalidate observers spuriously. Collapses
    /// the overflow popover when the new partition has nothing collapsed (web's "filters dropped to zero"
    /// + "removed the last overflow chip" effects, unified).
    public func update(
        _ input: ActiveFilterChipsInput,
        removeHandlers: [String: @MainActor () -> Void],
        onClearAll: (@MainActor () -> Void)?
    ) {
        self.removeHandlers = removeHandlers
        self.onClearAll = onClearAll
        if input != self.input {
            self.input = input
        }
        if overflowOpen, !ActiveFilterChipsProjector.resolve(input).partition.hasOverflow {
            overflowOpen = false
        }
    }

    /// Opens / closes the overflow popover (web `setOverflowOpen`).
    public func setOverflowOpen(_ open: Bool) {
        overflowOpen = open
    }

    /// Toggles the overflow popover (web `onClick={() => setOverflowOpen((v) => !v)}`).
    public func toggleOverflow() {
        overflowOpen.toggle()
    }

    /// Removes one chip — announces "Filter removed: {label}" politely (web live region), invokes the
    /// page's `onRemove`, and closes the popover when it was the last collapsed chip (web `if
    /// (overflow.length === 1) setOverflowOpen(false)`).
    public func remove(_ descriptor: FilterChipDescriptor) {
        announceCounter += 1
        let text = ActiveFilterChipsStrings.removedAnnouncement(
            label: descriptor.label,
            sequence: announceCounter
        )
        announcement = text
        announcer.announce(text)
        let overflow = projection.partition.overflow
        if overflow.count == 1, overflow.first?.id == descriptor.id {
            overflowOpen = false
        }
        removeHandlers[descriptor.id]?()
    }

    /// Clears every filter — announces "All filters cleared" politely (web live region) and invokes the
    /// page's `onClearAll`. A no-op when no `onClearAll` was supplied.
    public func clearAll() {
        guard let onClearAll else { return }
        announceCounter += 1
        let text = ActiveFilterChipsStrings.clearedAllAnnouncement(sequence: announceCounter)
        announcement = text
        announcer.announce(text)
        onClearAll()
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: ActiveFilterChipsSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
