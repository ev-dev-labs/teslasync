//
//  StaggerContainer.Model.swift
//  TeslaSync — P4 shared surface · 0193 · StaggerContainer (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  staggered-entrance container. The web `<StaggerContainer>` binds one display-boundary hook
//  (`useMotionPreference()`) and takes its content as `children`; there is no fetcher, so the native peer
//  needs no data state-holder. What the holder DOES own is the surface lifecycle: it carries the current
//  ``StaggerContainerInput`` (the props) + the bound reduce-motion flag (the native peer of the web
//  `useReducedMotion()`, injected from the app's `\.accessibilityReduceMotion` environment), the
//  orchestration ``StaggerContainerPhase`` that flips hidden → shown on appear (driving every hosted
//  child's cascade), derives the pure ``StaggerContainerProjection`` as an observed read (SwiftUI
//  observation replaces the React re-render), and emits the surface's single `view.opened` diagnostics
//  event. No networking lives here.
//
//  The web `<StaggerContainer>` renders no copy of its own, so the only localized strings resolved here are
//  the native a11y additions for the empty-content leaf (the "never a blank box" peer of the container
//  hosting no children) — there are no web `t()` keys to mirror.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "StaggerContainer" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source is anonymous, so these are native a11y additions only.
public enum StaggerContainerStrings {
    public static let table = "StaggerContainer"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The empty-content leaf's title — shown when the container has nothing to stagger, so the surface
    /// never renders a bare box (native HIG; the web container simply hosts no children).
    public static var emptyTitle: String {
        string("staggerContainer.empty", "Nothing to show yet")
    }

    /// The empty-content leaf's supporting line.
    public static var emptyMessage: String {
        string("staggerContainer.emptyMessage", "Items appear here as they become available.")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol StaggerContainerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogStaggerContainerTelemetry: StaggerContainerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - StaggerContainerModel (P1/S8) — surface lifecycle + derivation

/// The surface's observable state-holder. It owns the current ``StaggerContainerInput`` (the web props) +
/// the bound reduce-motion flag (web `useReducedMotion()`, reassigned from the `\.accessibilityReduceMotion`
/// environment by the view) + the orchestration ``StaggerContainerPhase``, derives the pure
/// ``StaggerContainerProjection`` as an observed read, and emits `view.opened` exactly once per instance.
/// The web component has no fetcher, so neither does this holder — `update(_:)` / `update(reduceMotion:)`
/// are the native peer of React re-rendering with new props / a new preference, reassigning only when the
/// value actually changes so an unrelated re-render does not invalidate observers.
@MainActor
@Observable
public final class StaggerContainerModel {
    /// The current props (web `props`). Reading it (or anything derived from it) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: StaggerContainerInput

    /// The bound Reduce Motion flag (web `useReducedMotion()`). Reassigned from the
    /// `\.accessibilityReduceMotion` environment by the view; a change re-derives the cascade.
    public private(set) var reduceMotion: Bool

    /// The orchestration phase. Starts `hidden` (the web `initial="hidden"`) and flips to `shown` on appear
    /// (the web `animate="show"`); observed so the cascade animates and every hosted child inherits it.
    public private(set) var phase: StaggerContainerPhase = .hidden

    @ObservationIgnored private let telemetry: any StaggerContainerTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: StaggerContainerInput,
        reduceMotion: Bool = false,
        telemetry: any StaggerContainerTelemetry = OSLogStaggerContainerTelemetry()
    ) {
        self.input = input
        self.reduceMotion = reduceMotion
        self.telemetry = telemetry
    }

    /// The resolved, view-ready cascade (web render output) — a pure function of the props + preference.
    public var projection: StaggerContainerProjection {
        StaggerContainerProjector.resolve(input, reduceMotion: reduceMotion)
    }

    /// Replaces the props — the native peer of React re-rendering with new props. Reassigns only when the
    /// inputs actually change so an unrelated re-render does not invalidate observers spuriously.
    public func update(_ input: StaggerContainerInput) {
        guard input != self.input else { return }
        self.input = input
    }

    /// Replaces the bound Reduce Motion flag — called by the view when the `\.accessibilityReduceMotion`
    /// environment changes. Reassigns only when the value actually changes.
    public func update(reduceMotion: Bool) {
        guard reduceMotion != self.reduceMotion else { return }
        self.reduceMotion = reduceMotion
    }

    /// Flips the orchestration to its `shown` phase (web `animate="show"`). Idempotent — once shown it stays
    /// shown, so a reused container does not replay its cascade on an unrelated re-render.
    public func reveal() {
        guard phase != .shown else { return }
        phase = .shown
    }

    /// Resets the orchestration back to `hidden` — the seam a host uses to replay the cascade (e.g. when a
    /// list re-keys). Not driven by the steady-state render.
    public func reset() {
        phase = .hidden
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: StaggerContainerSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
