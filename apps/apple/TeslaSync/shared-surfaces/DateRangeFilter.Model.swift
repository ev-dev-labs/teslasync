//
//  DateRangeFilter.Model.swift
//  TeslaSync — P4 shared surface · 0152 · DateRangeFilter (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the clock seam (so the active-preset `matchPresetId`
//  resolution is deterministic in tests), and the observable state-holder (P1/S8) for the inline date-range
//  filter. The web `<DateRangeFilter>` is purely presentational: it takes its data as plain props and renders,
//  with no fetcher — so the native peer needs no data state-holder. What the holder DOES own is the props
//  (the derived ``DateRangeFilterProjection`` is an observed read), the page-supplied change/apply closures
//  (kept here so the value types stay closure-free + `Equatable`), the clock + calendar used to resolve the
//  active preset and parse the ISO field values, and the single `view.opened` diagnostics event. No
//  networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded prose.
/// Keys live in the "DateRangeFilter" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping the
/// labels deterministic.
public enum DateRangeFilterStrings {
    public static let table = "DateRangeFilter"

    public static let string: DateRangeFilterResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The start field's accessible name (web `t('date.range.start', 'Start date')`).
    public static var startLabel: String {
        string("date.range.start", "Start date")
    }

    /// The end field's accessible name (web `t('date.range.end', 'End date')`).
    public static var endLabel: String {
        string("date.range.end", "End date")
    }

    /// The Apply button's title (web `t('date.range.apply', 'Apply')`).
    public static var applyLabel: String {
        string("date.range.apply", "Apply")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DateRangeFilterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDateRangeFilterTelemetry: DateRangeFilterTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Clock seam (web `useMemo` over `new Date()`)

/// Supplies "now" for resolving the active preset (web `matchPresetId` over the current `new Date()`) and the
/// fallback day a cleared `DatePicker` shows — the seam that makes the date math deterministic under test.
/// Production uses the wall clock; tests inject a fixed instant.
public protocol DateRangeFilterClock: Sendable {
    func now() -> Date
}

/// The wall-clock default (`Date()`), matching the web component resolving against the real "now".
public struct SystemDateRangeFilterClock: DateRangeFilterClock {
    public init() {}

    public func now() -> Date {
        Date()
    }
}

// MARK: - DateRangeFilterModel (P1/S8) — props + change routing

/// The surface's observable state-holder. It owns the current ``DateRangeFilterInput`` (the web props),
/// derives the pure ``DateRangeFilterProjection`` as an observed read (resolving the active preset against the
/// injected clock + calendar), routes a field edit or a preset tap back out through the page-supplied closures
/// (web `onStartDateChange` / `onEndDateChange` / `onRangeChange` / `onApply`), records the last applied range
/// for UI tests, and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DateRangeFilterModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: DateRangeFilterInput

    /// The most-recent range routed out (a field edit or a preset tap). Observed so a UI test can read what
    /// the surface last emitted without reaching into the page closures.
    public private(set) var lastRange: DateRangeFilterRange?

    @ObservationIgnored private var onStartDateChange: @MainActor (String) -> Void
    @ObservationIgnored private var onEndDateChange: @MainActor (String) -> Void
    @ObservationIgnored private var onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)?
    @ObservationIgnored private var onApply: (@MainActor () -> Void)?
    @ObservationIgnored private let clock: any DateRangeFilterClock
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let telemetry: any DateRangeFilterTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DateRangeFilterInput,
        onStartDateChange: @escaping @MainActor (String) -> Void = { _ in },
        onEndDateChange: @escaping @MainActor (String) -> Void = { _ in },
        onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)? = nil,
        onApply: (@MainActor () -> Void)? = nil,
        clock: any DateRangeFilterClock = SystemDateRangeFilterClock(),
        calendar: Calendar = DateRangeFilterDates.gregorian(),
        telemetry: any DateRangeFilterTelemetry = OSLogDateRangeFilterTelemetry()
    ) {
        self.input = input
        self.onStartDateChange = onStartDateChange
        self.onEndDateChange = onEndDateChange
        self.onRangeChange = onRangeChange
        self.onApply = onApply
        self.clock = clock
        self.calendar = calendar
        self.telemetry = telemetry
    }

    /// The resolved, view-ready output (web render decision) — a pure function of the props and "now".
    public var projection: DateRangeFilterProjection {
        DateRangeFilterProjector.resolve(input, now: clock.now(), calendar: calendar)
    }

    /// The `Date` the start `DatePicker` shows — the parsed ISO value, falling back to "now" when the page has
    /// not bound a start yet (an empty `<input type="date">` has no `Date` peer).
    public var startDate: Date {
        DateRangeFilterDates.date(from: input.startDate, calendar: calendar) ?? clock.now()
    }

    /// The `Date` the end `DatePicker` shows — the parsed ISO value, falling back to "now" when unbound.
    public var endDate: Date {
        DateRangeFilterDates.date(from: input.endDate, calendar: calendar) ?? clock.now()
    }

    /// Replaces the props + the page closures — the native peer of React re-rendering with new props. The
    /// closures are always refreshed (recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(
        _ input: DateRangeFilterInput,
        onStartDateChange: @escaping @MainActor (String) -> Void,
        onEndDateChange: @escaping @MainActor (String) -> Void,
        onRangeChange: (@MainActor (DateRangeFilterRange) -> Void)?,
        onApply: (@MainActor () -> Void)?
    ) {
        self.onStartDateChange = onStartDateChange
        self.onEndDateChange = onEndDateChange
        self.onRangeChange = onRangeChange
        self.onApply = onApply
        if input != self.input {
            self.input = input
        }
    }

    /// Routes a start-field edit out through the page's `onStartDateChange` (web `onChange={e =>
    /// onStartDateChange(e.target.value)}`). No `onApply` fires on a manual edit — only the preset chips and
    /// the explicit Apply button do.
    public func setStart(_ iso: String) {
        onStartDateChange(iso)
    }

    /// Routes an end-field edit out through the page's `onEndDateChange` (web `onChange={e =>
    /// onEndDateChange(e.target.value)}`).
    public func setEnd(_ iso: String) {
        onEndDateChange(iso)
    }

    /// The `DatePicker` boundary for the start field — formats the picked `Date` to the web `YYYY-MM-DD` value
    /// using the holder's calendar, then routes it through ``setStart(_:)``.
    public func setStart(date: Date) {
        setStart(DateRangeFilterDates.iso(from: date, calendar: calendar))
    }

    /// The `DatePicker` boundary for the end field — formats the picked `Date` to the web `YYYY-MM-DD` value
    /// using the holder's calendar, then routes it through ``setEnd(_:)``.
    public func setEnd(date: Date) {
        setEnd(DateRangeFilterDates.iso(from: date, calendar: calendar))
    }

    /// Handles a preset-chip selection — the verbatim port of the web `handlePreset`: when the page supplies an
    /// atomic `onRangeChange` it routes the whole range there (avoiding the same-tick double-setter race),
    /// otherwise it routes the start then the end individually; either way it then fires `onApply` if present.
    public func handlePreset(_ range: DateRangeFilterRange) {
        if let onRangeChange {
            onRangeChange(range)
        } else {
            onStartDateChange(range.start)
            onEndDateChange(range.end)
        }
        lastRange = range
        onApply?()
    }

    /// Fires the page's `onApply` (web `<Button onClick={onApply}>`). A no-op when the page supplied none.
    public func apply() {
        onApply?()
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear churn —
    /// the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DateRangeFilterSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
