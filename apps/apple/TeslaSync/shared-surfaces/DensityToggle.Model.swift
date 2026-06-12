//
//  DensityToggle.Model.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  list-density selector. The web `<DensityToggle>` is a purely presentational CONTROLLED component: it
//  takes its value as a plain prop and reports changes back through `onChange`, with no fetcher — so the
//  native peer needs no data state-holder. What the holder DOES own is the props (the derived
//  ``DensityToggleProjection`` is an observed read), the `onChange` closure (kept here so the value types
//  stay closure-free + `Equatable`), the i18n resolver, and the single `view.opened` diagnostics event; it
//  routes both a direct selection (web `onClick`) and an arrow-key move (web `onKeyDown`) back out through
//  the page-supplied `onChange`. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "DensityToggle" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic.
public enum DensityToggleStrings {
    public static let table = "DensityToggle"

    public static let string: DensityToggleResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// One option's label (web `labelMap[opt]` — `t('density.table' | 'density.compact' |
    /// 'density.comfortable')`).
    public static func label(for density: Density) -> String {
        string(density.labelKey, density.labelFallback)
    }

    /// The radiogroup's default accessible name (web `t('density.groupLabel', 'List density')`).
    public static var groupLabel: String {
        string(Density.groupLabelKey, Density.groupLabelFallback)
    }

    /// The friendly body shown when no options are supplied (native — never a blank box).
    public static var empty: String {
        string("densityToggle.empty", "No density options")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DensityToggleTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDensityToggleTelemetry: DensityToggleTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - DensityToggleModel (P1/S8) — props + derivation + routing

/// The surface's observable state-holder. It owns the current ``DensityToggleInput`` (the web props),
/// derives the pure ``DensityToggleProjection`` as an observed read, routes a direct selection (web
/// `onClick`) and an arrow-key move (web `onKeyDown`) through the page-supplied `onChange`, and emits
/// `view.opened` exactly once per instance.
@MainActor
@Observable
public final class DensityToggleModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: DensityToggleInput

    @ObservationIgnored private var onChange: @MainActor (Density) -> Void
    @ObservationIgnored private let telemetry: any DensityToggleTelemetry
    @ObservationIgnored private let resolve: DensityToggleResolve
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DensityToggleInput,
        onChange: @escaping @MainActor (Density) -> Void = { _ in },
        telemetry: any DensityToggleTelemetry = OSLogDensityToggleTelemetry(),
        resolve: @escaping DensityToggleResolve = DensityToggleStrings.string
    ) {
        self.input = input
        self.onChange = onChange
        self.telemetry = telemetry
        self.resolve = resolve
    }

    /// The resolved, view-ready selector (web render output) — a pure function of the current props.
    public var projection: DensityToggleProjection {
        DensityToggleProjector.resolve(input, strings: resolve)
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: DensityToggleInput, onChange: @escaping @MainActor (Density) -> Void) {
        self.onChange = onChange
        if input != self.input {
            self.input = input
        }
    }

    /// Commits a direct selection — the web `onClick={() => onChange(opt)}`. Guards that the option is one
    /// of the rendered options (it always is, since segments are derived from `options`), then reports it.
    public func select(_ density: Density) {
        guard input.options.contains(density) else { return }
        onChange(density)
    }

    /// Commits an arrow-key move — the web `onKeyDown` handler. Resolves the next option through the pure
    /// projector (wrapping at the ends; a no-op when the current value is not in the options) and reports
    /// it through `onChange`.
    public func move(_ direction: DensityToggleProjector.Direction) {
        guard let next = DensityToggleProjector.next(
            after: input.value,
            in: input.options,
            moving: direction
        ) else { return }
        onChange(next)
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: DensityToggleSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
