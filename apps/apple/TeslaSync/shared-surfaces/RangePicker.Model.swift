//
//  RangePicker.Model.swift
//  TeslaSync — P4 shared surface · 0157 · RangePicker (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the read source seam (P1/S8), and the observable
//  state-holder for the single-trigger date-range filter. The web `<RangePicker>`'s only hook is
//  `useTranslation`; its `value` is a prop the page owns and `onChange` is a callback. The native peer keeps
//  that contract — the page's current range + props arrive through ``RangePickerSource`` snapshots, and
//  commits route back out through the page-supplied `onChange` / `onCompareChange` closures — while the
//  holder owns the interaction state (open flag, the staged calendar range, the compare flag), derives the
//  view-ready projection, drives the P4 leaf phases (loading / content / empty / error) + the freshness axis
//  (stale auto-refresh once / offline keeps cached), and emits `view.opened` exactly once.
//

import Foundation
import Observation

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "RangePicker" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback.
public enum RangePickerStrings {
    public static let table = "RangePicker"

    public static let string: RangePickerResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static var triggerLabel: String {
        string("date.range.trigger", "Date range")
    }

    public static var popoverLabel: String {
        string("date.range.popoverLabel", "Date range picker")
    }

    public static var presetGroupLabel: String {
        string("date.preset.label", "Quick date range")
    }

    public static var compareLabel: String {
        string("date.range.compare", "Compare to previous period")
    }

    public static var cancel: String {
        string("date.range.cancel", "Cancel")
    }

    public static var apply: String {
        string("date.range.apply", "Apply")
    }

    public static var loadingA11y: String {
        string("rangePicker.loadingA11y", "Loading date range")
    }

    public static var errorTitle: String {
        string("rangePicker.errorTitle", "Couldn't load date range")
    }

    public static var retry: String {
        string("rangePicker.retry", "Retry")
    }

    public static var empty: String {
        string("rangePicker.empty", "No date ranges available")
    }

    public static var live: String {
        string("rangePicker.live", "Live")
    }

    public static var stale: String {
        string("rangePicker.stale", "Stale")
    }

    public static var offline: String {
        string("rangePicker.offline", "Offline")
    }

    public static var staleA11y: String {
        string("rangePicker.staleA11y", "Stale — tap to refresh")
    }

    public static var offlineA11y: String {
        string("rangePicker.offlineA11y", "Offline — showing the last range")
    }

    public static var dayStart: String {
        string("rangePicker.dayStart", "Range start")
    }

    public static var dayEnd: String {
        string("rangePicker.dayEnd", "Range end")
    }

    public static var dayInRange: String {
        string("rangePicker.dayInRange", "In selected range")
    }

    /// "{{count}} days" with the i18next placeholder interpolated (web `date.range.summaryDays`). // parity:allow ui
    public static func summaryDays(_ count: Int) -> String {
        string("date.range.summaryDays", "{{count}} days")
            .replacingOccurrences(of: "{{count}}", with: String(count))
    }
}

// MARK: - RangePickerModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. Owns the props (web `value` + props), the open flag, the staged
/// calendar range, the compare flag, the P4 phase + connectivity; derives the view-ready projection; routes
/// preset commits + Apply through the page's `onChange` and the toggle through `onCompareChange`; auto-
/// refreshes once on a stale transition; and emits `view.opened` exactly once.
@MainActor
@Observable
public final class RangePickerModel {
    public private(set) var input: RangePickerInput
    public private(set) var phase: RangePickerPhase = .loading
    public private(set) var connection: RangePickerConnection = .live
    public private(set) var isOpen = false
    public private(set) var stagedStart: String?
    public private(set) var stagedEnd: String?
    public private(set) var compare: Bool

    @ObservationIgnored private let source: any RangePickerSource
    @ObservationIgnored private let onChange: @MainActor (RangePickerValue, String?) -> Void
    @ObservationIgnored private let onCompareChange: (@MainActor (Bool) -> Void)?
    @ObservationIgnored private let telemetry: any RangePickerTelemetry
    @ObservationIgnored private let nowProvider: () -> Date
    @ObservationIgnored let calendar: Calendar
    @ObservationIgnored let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false
    @ObservationIgnored private var didAutoRefresh = false

    public init(
        source: any RangePickerSource,
        onChange: @escaping @MainActor (RangePickerValue, String?) -> Void = { _, _ in },
        onCompareChange: (@MainActor (Bool) -> Void)? = nil,
        telemetry: any RangePickerTelemetry = OSLogRangePickerTelemetry(),
        now: @escaping () -> Date = { Date() },
        calendar: Calendar = RangePickerDates.gregorian(),
        locale: Locale = .current
    ) {
        self.source = source
        self.onChange = onChange
        self.onCompareChange = onCompareChange
        self.telemetry = telemetry
        nowProvider = now
        self.calendar = calendar
        self.locale = locale
        input = RangePickerInput(value: RangePickerValue(start: "", end: ""))
        compare = false
        source.onUpdate = { [weak self] snapshot in self?.ingest(snapshot) }
    }

    // MARK: Derived reads

    /// The resolved, view-ready picker — a pure function of the current props (web render output).
    public var projection: RangePickerProjection {
        RangePickerProjector.resolve(
            input, now: nowProvider(), calendar: calendar, locale: locale, strings: RangePickerStrings.string
        )
    }

    /// The lower selectable bound (web `minDateObj`).
    public var minISO: String? {
        input.minDate
    }

    /// The upper selectable bound — `maxDate`, else today (web `maxDateObj ?? new Date()`).
    public var maxISO: String? {
        input.maxDate ?? RangePickerDates.iso(from: nowProvider(), calendar: calendar)
    }

    /// The 1-based first weekday for the active language (web `weekStartsOn`).
    public var firstWeekday: Int {
        RangePickerCalendarBuilder.firstWeekday(forLanguage: languageCode)
    }

    /// Whether the staged range differs from the committed value (web `stagedDirty`) — gates Apply.
    public var stagedDirty: Bool {
        RangePickerProjector.isStagedDirty(stagedStart: stagedStart, stagedEnd: stagedEnd, value: input.value)
    }

    /// The staged range's inclusive day count, or `nil` when incomplete (web `stagedDays`).
    public var stagedDays: Int? {
        RangePickerProjector.stagedDays(stagedStart: stagedStart, stagedEnd: stagedEnd, calendar: calendar)
    }

    private var languageCode: String {
        locale.language.languageCode?.identifier ?? locale.identifier
    }

    // MARK: Lifecycle

    /// Begins the surface, emits `view.opened` once, and starts the source. Idempotent across appear churn.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: RangePickerSurface.slug)
        }
        source.start()
    }

    /// Marks the surface inactive. The once-only `view.opened` contract is preserved.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the page's current range (web has no peer; the freshness chip's retry).
    public func refresh() {
        source.refresh()
    }

    // MARK: Source ingestion

    /// Folds a pushed snapshot into the props + phase + connectivity, and auto-refreshes once on a stale read.
    private func ingest(_ snapshot: RangePickerSnapshot) {
        input = snapshot.input
        compare = snapshot.input.compare
        connection = snapshot.connection
        if snapshot.isLoading {
            phase = .loading
        } else if let message = snapshot.errorMessage {
            phase = .error(message)
        } else {
            phase = projection.isEmpty ? .empty : .content
        }
        if connection == .stale, !didAutoRefresh {
            didAutoRefresh = true
            source.refresh()
        }
    }

    // MARK: Interactions (web handlers)

    /// Apply a preset immediately and close (web `handlePreset` → `onChange(range, id)` + `setOpen(false)`).
    public func selectPreset(_ id: String) {
        guard let resolved = resolvePreset(id) else { return }
        onChange(resolved, id)
        setOpen(false)
    }

    /// Stage a calendar day (web `onSelect`): a complete or empty range starts fresh; otherwise the second
    /// pick extends forward (or moves the start backward). Nothing is committed until ``apply()``.
    public func pickDay(_ iso: String) {
        if stagedStart == nil || stagedEnd != nil {
            stagedStart = iso
            stagedEnd = nil
        } else if let start = stagedStart {
            if iso < start { stagedStart = iso } else { stagedEnd = iso }
        }
    }

    /// Commit the staged range and close (web `handleApply`); a no-op unless a valid ordered range is staged.
    public func apply() {
        guard let start = stagedStart, let end = stagedEnd, start <= end else { return }
        onChange(RangePickerValue(start: start, end: end), nil)
        setOpen(false)
    }

    /// Discard the staged range and close (web `handleCancel`).
    public func cancel() {
        setOpen(false)
    }

    /// Open / close the popover. Opening re-stages the current range (web open `useEffect`); closing discards.
    public func setOpen(_ open: Bool) {
        isOpen = open
        if open {
            stagedStart = input.value.start
            stagedEnd = input.value.end
        } else {
            stagedStart = nil
            stagedEnd = nil
        }
    }

    /// Toggle the popover (web trigger `onClick`).
    public func toggleOpen() {
        setOpen(!isOpen)
    }

    /// Flip the compare flag and notify the page (web `onCompareChange`).
    public func setCompare(_ next: Bool) {
        compare = next
        onCompareChange?(next)
    }

    /// Resolve a preset's range, applying the `minDate` floor for "All time" (web `handlePreset`).
    private func resolvePreset(_ id: String) -> RangePickerValue? {
        guard let base = RangePickerPresets.resolve(id, now: nowProvider(), calendar: calendar) else { return nil }
        guard id == "all" else { return base }
        return RangePickerValue(start: RangePickerPresets.resolveAllTimeStart(minDate: input.minDate), end: base.end)
    }
}
