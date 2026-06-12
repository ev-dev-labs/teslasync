//
//  SortControl.Model.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  list sort control. The web `<SortControl>` is a purely presentational CONTROLLED component: it takes its
//  `field` + `direction` as plain props and reports changes back through `onFieldChange` /
//  `onDirectionChange`, with no fetcher — so the native peer needs no data state-holder. What the holder
//  DOES own is the props (the derived ``SortControlProjection`` is an observed read), the two `onChange`
//  closures (kept here so the value types stay closure-free + `Equatable`), the i18n resolver, and the
//  single `view.opened` diagnostics event; it routes a field selection (web `onChange` on the `<select>`)
//  and a direction flip (web `flip` on the button) back out through the page-supplied closures. No
//  networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "SortControl" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum SortControlStrings {
    public static let table = "SortControl"

    public static let string: SortControlResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// One direction's label (web `dirLabel` — `t('sortControl.ascending' | 'sortControl.descending')`).
    public static func directionLabel(for direction: SortDirection) -> String {
        string(direction.labelKey, direction.labelFallback)
    }

    /// The field dropdown's accessible name (web `t('sortControl.fieldLabel', 'Sort by')`).
    public static var fieldMenuLabel: String {
        string("sortControl.fieldLabel", "Sort by")
    }

    /// The direction word used to build the button's accessible name (web `t('sortControl.direction', 'Sort
    /// direction')`).
    public static var directionWord: String {
        string("sortControl.direction", "Sort direction")
    }

    /// The friendly body shown when no field options are supplied (native — never a bare box).
    public static var empty: String {
        string("sortControl.empty", "No sort fields")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol SortControlTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogSortControlTelemetry: SortControlTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - SortControlModel (P1/S8) — props + derivation + routing

/// The surface's observable state-holder. It owns the current ``SortControlInput`` (the web props), derives
/// the pure ``SortControlProjection`` as an observed read, routes a field selection (web `<select>`
/// `onChange`) and a direction flip (web button `onClick`) through the page-supplied closures, and emits
/// `view.opened` exactly once per instance.
@MainActor
@Observable
public final class SortControlModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: SortControlInput

    @ObservationIgnored private var onFieldChange: @MainActor (String) -> Void
    @ObservationIgnored private var onDirectionChange: @MainActor (SortDirection) -> Void
    @ObservationIgnored private let telemetry: any SortControlTelemetry
    @ObservationIgnored private let resolve: SortControlResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: SortControlInput,
        onFieldChange: @escaping @MainActor (String) -> Void = { _ in },
        onDirectionChange: @escaping @MainActor (SortDirection) -> Void = { _ in },
        telemetry: any SortControlTelemetry = OSLogSortControlTelemetry(),
        resolve: @escaping SortControlResolve = SortControlStrings.string
    ) {
        self.input = input
        self.onFieldChange = onFieldChange
        self.onDirectionChange = onDirectionChange
        self.telemetry = telemetry
        self.resolve = resolve
    }

    /// The resolved, view-ready control (web render output) — a pure function of the current props.
    public var projection: SortControlProjection {
        SortControlProjector.resolve(input, strings: resolve)
    }

    /// Replaces the props + the page closures — the native peer of React re-rendering with new props. The
    /// closures are always refreshed (they are recreated each parent render); the props reassign only when
    /// they actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(
        _ input: SortControlInput,
        onFieldChange: @escaping @MainActor (String) -> Void,
        onDirectionChange: @escaping @MainActor (SortDirection) -> Void
    ) {
        self.onFieldChange = onFieldChange
        self.onDirectionChange = onDirectionChange
        if input != self.input {
            self.input = input
        }
    }

    /// Commits a field selection — the web `onChange={(e) => onFieldChange(e.target.value)}`. Guards that
    /// the field is one of the rendered options (it always is, since the menu items are derived from
    /// `options`), then reports it.
    public func selectField(_ value: String) {
        guard input.options.contains(where: { $0.value == value }) else { return }
        onFieldChange(value)
    }

    /// Commits a direction flip — the web `flip = () => onDirectionChange(direction === 'asc' ? 'desc' :
    /// 'asc')`. Reports the flipped direction through `onDirectionChange`.
    public func toggleDirection() {
        onDirectionChange(SortControlProjector.toggled(input.direction))
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: SortControlSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
