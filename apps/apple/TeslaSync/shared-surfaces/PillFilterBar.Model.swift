//
//  PillFilterBar.Model.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  single-select pill / tab filter row. The web `<PillFilterBar>` is purely presentational: it takes its
//  data as plain props and renders, with no fetcher — so the native peer needs no data state-holder. What
//  the holder DOES own is the surface's interaction state (the roving keyboard-focus target), the props
//  (the derived ``PillFilterBarProjection`` is an observed read), the page's `onChange` closure (kept here
//  so the value types stay closure-free + `Equatable`), and the single `view.opened` diagnostics event.
//  Selection + the WAI-ARIA Tabs arrow / Home / End travel route through here so a UI test can drive them
//  without a live keyboard. No networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. The web `<PillFilterBar>` holds NO `t()` calls of its own — its pill labels + `ariaLabel` arrive
/// already-localised as props (the page owns them), exactly as in the source — so the only facade-resolved
/// string is the native empty-group state (the web renders an empty row; the native HIG calls for a
/// labelled empty state rather than a bare box). Keys live in the "PillFilterBar" table, folded into the
/// app `Localizable.xcstrings` at integration time; in test / preview bundles `NSLocalizedString` returns
/// the `value:` fallback, keeping the labels deterministic.
public enum PillFilterBarStrings {
    public static let table = "PillFilterBar"

    public static let string: PillFilterBarResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Friendly empty-row body (native — never a blank box).
    public static var empty: String {
        string("pillFilterBar.empty", "No filters available")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol PillFilterBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogPillFilterBarTelemetry: PillFilterBarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - PillFilterBarModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``PillFilterBarInput`` (the web props) and
/// the roving keyboard-focus target (web `refs.current.get(nextKey)?.focus()`); derives the pure
/// ``PillFilterBarProjection`` as an observed read; routes selection + the arrow / Home / End travel
/// through the page-supplied `onChange` (web `onChange` / `moveFocus`); and emits `view.opened` exactly
/// once per instance.
@MainActor
@Observable
public final class PillFilterBarModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: PillFilterBarInput

    /// The pill the surface wants the keyboard / VoiceOver focus on (web `moveFocus` → `ref.focus()`).
    /// `nil` until an arrow / Home / End moves it; the view mirrors it into its `@FocusState`. Observed so
    /// a UI test can assert where focus was driven.
    public private(set) var focusedKey: String?

    @ObservationIgnored private var onChange: (@MainActor (String) -> Void)?
    @ObservationIgnored private let telemetry: any PillFilterBarTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: PillFilterBarInput,
        onChange: (@MainActor (String) -> Void)? = nil,
        telemetry: any PillFilterBarTelemetry = OSLogPillFilterBarTelemetry()
    ) {
        self.input = input
        self.onChange = onChange
        self.telemetry = telemetry
    }

    /// The resolved, view-ready row (web render output) — a pure function of the current props.
    public var projection: PillFilterBarProjection {
        PillFilterBarProjector.resolve(input)
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously. Clears the
    /// focus request when the focused pill is no longer selectable (removed / now disabled).
    public func update(_ input: PillFilterBarInput, onChange: (@MainActor (String) -> Void)?) {
        self.onChange = onChange
        if input != self.input {
            self.input = input
        }
        if let focusedKey, !projection.enabledKeys.contains(focusedKey) {
            self.focusedKey = nil
        }
    }

    /// Selects a pill — the web `onClick={() => onChange(item.key)}`. Disabled pills are inert (the web
    /// `<button disabled>` blocks the click), so a disabled / unknown key is a no-op.
    public func select(_ key: String) {
        guard projection.enabledKeys.contains(key) else { return }
        onChange?(key)
    }

    /// Moves selection + focus one step in `direction`, wrapping around the enabled ring — the web
    /// `ArrowLeft` / `ArrowRight` branch of `handleKeyDown` (`moveFocus(enabledKeys[nextIdx])`). A no-op
    /// when nothing is enabled or the active key is itself disabled (web `idx === -1`).
    public func move(_ direction: PillNavigationDirection) {
        guard let next = PillFilterBarProjector.nextKey(
            from: input.activeKey,
            direction: direction,
            in: projection.enabledKeys
        ) else { return }
        focusedKey = next
        onChange?(next)
    }

    /// Moves selection + focus to the first enabled pill — the web `Home` branch (`moveFocus(enabledKeys[0])`).
    public func moveToFirst() {
        guard let key = PillFilterBarProjector.firstKey(in: projection.enabledKeys) else { return }
        focusedKey = key
        onChange?(key)
    }

    /// Moves selection + focus to the last enabled pill — the web `End` branch
    /// (`moveFocus(enabledKeys[length - 1])`).
    public func moveToLast() {
        guard let key = PillFilterBarProjector.lastKey(in: projection.enabledKeys) else { return }
        focusedKey = key
        onChange?(key)
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: PillFilterBarSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
