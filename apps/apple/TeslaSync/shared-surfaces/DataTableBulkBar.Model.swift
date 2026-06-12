//
//  DataTableBulkBar.Model.swift
//  TeslaSync — P4 shared surface · 0209 · DataTableBulkBar (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), the polite-announcement seam (the native parity
//  of the web count span's `aria-live="polite"`), and the observable state-holder (P1/S8) for the table
//  selection toolbar. The web `<DataTableBulkBar>` is purely presentational: it takes its data as plain
//  props and renders, with no fetcher — so the native peer needs no data state-holder. What the holder
//  DOES own is the surface's interaction wiring (the page-supplied `onClear` closure, kept here so the
//  value types stay closure-free + `Equatable`), the last polite announcement, the derived
//  ``DataTableBulkBarProjection`` (an observed read), and the single `view.opened` diagnostics event. No
//  networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "DataTableBulkBar" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback,
/// keeping the labels deterministic.
public enum DataTableBulkBarStrings {
    public static let table = "DataTableBulkBar"

    public static let string: DataTableBulkBarResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Region container label (web `t('table.bulkActions.region', 'Bulk actions')`).
    public static var regionLabel: String {
        string("table.bulkActions.region", "Bulk actions")
    }

    /// "Clear selection" affordance (web `t('table.bulkActions.clear', 'Clear selection')`).
    public static var clear: String {
        string("table.bulkActions.clear", "Clear selection")
    }

    /// The "{{count}} selected" label (web `t('table.bulkActions.selected', '{{count}} selected',
    /// { count })`), with `{{count}}` interpolated.
    public static func selected(_ count: Int) -> String {
        DataTableBulkBarProjector.selectedLabel(
            template: string("table.bulkActions.selected", "{{count}} selected"),
            count: count
        )
    }

    /// The polite selection announcement (the spoken peer of the web count span's `aria-live="polite"`),
    /// padded for re-announcement.
    public static func selectionAnnouncement(count: Int, sequence: Int) -> String {
        DataTableBulkBarProjector.selectionAnnouncement(
            selectedText: selected(count),
            sequence: sequence
        )
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DataTableBulkBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDataTableBulkBarTelemetry: DataTableBulkBarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Announcement seam (native parity of the web count span `aria-live="polite"`)

/// Posts a polite announcement to the assistive technology — the native boundary that replaces the web
/// count span's `aria-live="polite"`. The view injects ``LiveDataTableBulkBarAnnouncer`` (which posts an
/// `AccessibilityNotification.Announcement`); tests inject a recording double; the model default logs so
/// previews never emit live speech.
@MainActor
public protocol DataTableBulkBarAnnouncer {
    func announce(_ message: String)
}

/// `os.Logger`-backed default that records the intent without driving the assistive technology, so
/// previews and headless models run quietly.
@MainActor
public struct OSLogDataTableBulkBarAnnouncer: DataTableBulkBarAnnouncer {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "accessibility") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func announce(_ message: String) {
        logger.info("announce length=\(message.count, privacy: .public)")
    }
}

// MARK: - DataTableBulkBarModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``DataTableBulkBarInput`` (the web props)
/// and the last polite announcement string; derives the pure ``DataTableBulkBarProjection`` as an
/// observed read; routes the clear request through the page-supplied `onClear` (web `onClick={onClear}`);
/// posts the polite "{{count}} selected" announcement when the visible selection count changes (web
/// `aria-live="polite"`); and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DataTableBulkBarModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: DataTableBulkBarInput

    /// The most-recent polite live-region text. Observed so a UI test can read what VoiceOver was asked
    /// to speak; the real voicing happens through the announcer seam.
    public private(set) var announcement = ""

    @ObservationIgnored private var onClear: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any DataTableBulkBarTelemetry
    @ObservationIgnored private let announcer: any DataTableBulkBarAnnouncer
    @ObservationIgnored private var announceCounter = 0
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DataTableBulkBarInput,
        onClear: (@MainActor () -> Void)? = nil,
        telemetry: any DataTableBulkBarTelemetry = OSLogDataTableBulkBarTelemetry(),
        announcer: any DataTableBulkBarAnnouncer = OSLogDataTableBulkBarAnnouncer()
    ) {
        self.input = input
        self.onClear = onClear
        self.telemetry = telemetry
        self.announcer = announcer
    }

    /// The resolved, view-ready toolbar (web render output) — a pure function of the current props.
    public var projection: DataTableBulkBarProjection {
        DataTableBulkBarProjector.resolve(input)
    }

    /// Clears the selection — the verbatim port of the web `onClick={onClear}`. A no-op when no `onClear`
    /// was supplied.
    public func clear() {
        onClear?()
    }

    /// Posts the polite "{{count}} selected" announcement (web count-span `aria-live="polite"`) and
    /// records it for observation. Guarded to the visible bar so a hidden (`count <= 0`) toolbar — which
    /// the web unmounts — never speaks.
    public func announceSelectionIfVisible() {
        guard !projection.isHidden else { return }
        announceCounter += 1
        let text = DataTableBulkBarStrings.selectionAnnouncement(
            count: input.count,
            sequence: announceCounter
        )
        announcement = text
        announcer.announce(text)
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when
    /// they actually change so an unrelated re-render does not invalidate observers spuriously. When the
    /// visible selection count changes it re-posts the polite announcement, mirroring the web live region
    /// re-firing as its "{{count}} selected" text changes.
    public func update(_ input: DataTableBulkBarInput, onClear: (@MainActor () -> Void)?) {
        self.onClear = onClear
        let previousCount = self.input.count
        if input != self.input {
            self.input = input
        }
        if input.count != previousCount {
            announceSelectionIfVisible()
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DataTableBulkBarSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
