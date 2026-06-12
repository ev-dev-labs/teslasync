//
//  StickyChipBar.Model.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  in-page section nav. The web `<StickyChipBar>` is purely presentational: it takes its data as plain
//  props and renders, with no fetcher — so the native peer needs no data state-holder. What the holder
//  DOES own is the surface's interaction state (the active chip id — web `activeId`), the props (the
//  derived ``StickyChipBarProjection`` is an observed read), the page-supplied `onSelect` closure (kept
//  here so the value types stay closure-free + `Equatable`), and the single `view.opened` diagnostics
//  event. The two browser facilities the web component consumes map onto the holder: a user tap routes
//  through ``select(_:)`` (web `handleClick` — set active + scroll the page container) and the host's
//  scroll-spy feeds ``reportVisibleSection(_:)`` (the native peer of `IntersectionObserver`). No
//  networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web label, routed through a key

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// prose. Keys live in the "StickyChipBar" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source hardcodes its one literal (`aria-label="Jump to section"`);
/// the native surface routes it (and the native a11y additions) through the facade per the no-hardcoded
/// -English rule.
public enum StickyChipBarStrings {
    public static let table = "StickyChipBar"

    public static let string: StickyChipBarResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The nav container label (web `aria-label="Jump to section"`).
    public static var jumpToSection: String {
        string("stickyChipBar.ariaLabel", "Jump to section")
    }

    /// Friendly empty-strip body (native — never a blank box; the web renders a bare empty nav).
    public static var empty: String {
        string("stickyChipBar.empty", "No sections")
    }

    /// One chip's VoiceOver hint (native a11y addition — clarifies that activating the pill scrolls to its
    /// section, the action behind the web `handleClick`).
    public static var chipHint: String {
        string("stickyChipBar.chipHint", "Jumps to section")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol StickyChipBarTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogStickyChipBarTelemetry: StickyChipBarTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - StickyChipBarModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``StickyChipBarInput`` (the web props) and
/// the active chip id (web `activeId`); derives the pure ``StickyChipBarProjection`` as an observed read;
/// routes a user tap through the page-supplied `onSelect` (web `handleClick` — which also scrolls the
/// page's scroll container) while updating the active id; accepts the host scroll-spy's visible-section
/// reports (the native peer of `IntersectionObserver`); and emits `view.opened` exactly once per instance.
@MainActor
@Observable
public final class StickyChipBarModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: StickyChipBarInput

    /// The highlighted chip id (web `activeId`). Observed so the strip restyles + auto-scrolls the active
    /// pill into view when it changes (whether from a tap or a scroll-spy report).
    public private(set) var activeID: String

    @ObservationIgnored private var onSelect: (@MainActor (String) -> Void)?
    @ObservationIgnored private let telemetry: any StickyChipBarTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: StickyChipBarInput,
        onSelect: (@MainActor (String) -> Void)? = nil,
        telemetry: any StickyChipBarTelemetry = OSLogStickyChipBarTelemetry(),
        initialActiveID: String? = nil
    ) {
        self.input = input
        self.onSelect = onSelect
        self.telemetry = telemetry
        activeID = initialActiveID ?? StickyChipBarProjector.defaultActiveID(input.chips)
    }

    /// The resolved, view-ready strip (web render output) — a pure function of the current props.
    public var projection: StickyChipBarProjection {
        StickyChipBarProjector.resolve(input)
    }

    /// Whether a chip is the active one (web `chip.id === activeId`).
    public func isActive(_ id: String) -> Bool {
        StickyChipBarProjector.isActive(id, activeID: activeID)
    }

    /// Handles a user tap on a chip — the web `handleClick`. Sets the active id (web `setActiveId`) and
    /// routes out through the page's `onSelect` so the host scrolls its container to the section (web
    /// scrolls `#main-content` / the window). `onSelect` fires even when the chip is already active, so a
    /// re-tap re-scrolls to the top of the section, exactly as the web does. Ignores ids not in the set.
    public func select(_ id: String) {
        guard StickyChipBarProjector.contains(id, in: input.chips) else { return }
        if activeID != id {
            activeID = id
        }
        onSelect?(id)
    }

    /// Records the topmost-visible section reported by the host's scroll-spy — the native peer of the web
    /// `IntersectionObserver` callback (`setActiveId(top.target.id)`). Updates the highlight WITHOUT
    /// invoking `onSelect` (this is passive observation, not a user jump). Ignores ids not in the set.
    public func reportVisibleSection(_ id: String) {
        guard StickyChipBarProjector.contains(id, in: input.chips) else { return }
        if activeID != id {
            activeID = id
        }
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously. Re-validates the
    /// active id against the new chip set (web re-runs its observer over the new anchors), so a removed
    /// section never leaves a dangling highlight.
    public func update(_ input: StickyChipBarInput, onSelect: (@MainActor (String) -> Void)?) {
        self.onSelect = onSelect
        if input != self.input {
            self.input = input
        }
        let resolved = StickyChipBarProjector.resolveActiveID(requested: activeID, chips: input.chips)
        if resolved != activeID {
            activeID = resolved
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: StickyChipBarSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
