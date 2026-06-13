//
//  DatePresetChips.Model.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the clock seam (so the tap-time `new Date()`
//  resolution is deterministic in tests), and the observable state-holder (P1/S8) for the quick-select chip
//  row. The web `<DatePresetChips>` is purely presentational: it takes its data as plain props and renders,
//  with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is the props
//  (the derived ``DatePresetChipsProjection`` is an observed read), the page-supplied `onSelect` closure
//  (kept here so the value types stay closure-free + `Equatable`), the clock + calendar used to resolve a
//  tapped preset's range, the last resolved selection (observed, for UI tests), and the single `view.opened`
//  diagnostics event. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "DatePresetChips" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum DatePresetChipsStrings {
    public static let table = "DatePresetChips"

    public static let string: DatePresetChipsResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The group's accessible name (web `t('date.preset.label', 'Quick date range')`).
    public static var groupLabel: String {
        string("date.preset.label", "Quick date range")
    }

    /// One preset's visible label (web `t(p.i18nKey, p.fallback)`).
    public static func label(key: String, fallback: String) -> String {
        string(key, fallback)
    }

    /// Friendly body shown when no preset matched `presetIds`, so the row never renders a bare box (native —
    /// the web simply renders an empty group).
    public static var empty: String {
        string("datePresetChips.empty", "No quick ranges")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DatePresetChipsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDatePresetChipsTelemetry: DatePresetChipsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clock seam (web tap-time `new Date()`)

/// Supplies "now" for resolving a tapped preset's range — the seam that replaces the web component's
/// inline `new Date()` so the date math is deterministic under test. Production uses the wall clock; tests
/// inject a fixed instant.
public protocol DatePresetChipsClock: Sendable {
    func now() -> Date
}

/// The wall-clock default (`Date()`), matching the web component resolving against the real "now" on tap.
public struct SystemDatePresetChipsClock: DatePresetChipsClock {
    public init() {}

    public func now() -> Date {
        Date()
    }
}

// MARK: - DatePresetChipsModel (P1/S8) — props + tap-time resolution

/// The surface's observable state-holder. It owns the current ``DatePresetChipsInput`` (the web props),
/// derives the pure ``DatePresetChipsProjection`` as an observed read, resolves a tapped preset's range
/// against the injected clock + calendar (web `p.resolve()` over `new Date()`), routes the resulting
/// ``DatePresetChipsSelection`` back out through the page-supplied `onSelect` (web `onSelect`), records that
/// selection for UI tests, and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DatePresetChipsModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: DatePresetChipsInput

    /// The most-recent resolved selection (web's last `onSelect` payload). Observed so a UI test can read what
    /// the row last emitted without reaching into the page closure.
    public private(set) var lastSelection: DatePresetChipsSelection?

    @ObservationIgnored private var onSelect: @MainActor (DatePresetChipsSelection) -> Void
    @ObservationIgnored private let clock: any DatePresetChipsClock
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let telemetry: any DatePresetChipsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DatePresetChipsInput,
        onSelect: @escaping @MainActor (DatePresetChipsSelection) -> Void = { _ in },
        clock: any DatePresetChipsClock = SystemDatePresetChipsClock(),
        calendar: Calendar = DatePresetChipsCatalog.gregorian(),
        telemetry: any DatePresetChipsTelemetry = OSLogDatePresetChipsTelemetry()
    ) {
        self.input = input
        self.onSelect = onSelect
        self.clock = clock
        self.calendar = calendar
        self.telemetry = telemetry
    }

    /// The resolved, view-ready chip row (web render output) — a pure function of the current props.
    public var projection: DatePresetChipsProjection {
        DatePresetChipsProjector.resolve(input)
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(
        _ input: DatePresetChipsInput,
        onSelect: @escaping @MainActor (DatePresetChipsSelection) -> Void
    ) {
        self.onSelect = onSelect
        if input != self.input {
            self.input = input
        }
    }

    /// Handles a chip tap — resolves the preset's inclusive range against `clock.now()` (web `p.resolve()`),
    /// records it, and routes the `(id, start, end)` selection out through the page's `onSelect`. A no-op for
    /// an id the catalog does not know (the row only renders catalog ids, so this is defensive).
    public func select(_ id: String) {
        guard let range = DatePresetChipsCatalog.resolve(id, now: clock.now(), calendar: calendar) else {
            return
        }
        let selection = DatePresetChipsSelection(id: id, range: range)
        lastSelection = selection
        onSelect(selection)
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear churn
    /// — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DatePresetChipsSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
