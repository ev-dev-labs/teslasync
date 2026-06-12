//
//  Accordion.Model.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The i18n facade (P1/S10), the telemetry seam (P1/S11), and the observable state-holder (P1/S8) for the
//  collapsible section. The web `<Accordion>` is purely presentational: it takes its data as plain props
//  and renders, with no fetcher — so the native peer needs no data state-holder. What the holder DOES own
//  is the surface's interaction state (the uncontrolled `internalOpen` flag, the native peer of the web
//  `useState(defaultOpen)`), the props (the derived ``AccordionProjection`` is an observed read), the
//  page-supplied `onOpenChange` closure (kept here so the value types stay closure-free + `Equatable`),
//  and the single `view.opened` diagnostics event. No networking lives here.
//
//  The web source renders no copy of its own (its `title` is a caller-supplied prop), so the only localized
//  strings resolved here are the native a11y additions — the expand / collapse hint, the expanded /
//  collapsed value, and the empty-body leaf — there are no web `t()` keys to mirror.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with an English fallback, so the Swift sources hold no hardcoded
/// prose. Keys live in the "Accordion" table, folded into the app `Localizable.xcstrings` catalog at
/// integration time; in test / preview bundles `NSLocalizedString` returns the `value:` fallback, keeping
/// the labels deterministic. The web source is anonymous, so these are native a11y additions only.
public enum AccordionStrings {
    public static let table = "Accordion"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// VoiceOver hint when the section is collapsed — the action a tap performs (native a11y addition).
    public static var expandHint: String {
        string("accordion.expandHint", "Expand section")
    }

    /// VoiceOver hint when the section is expanded — the action a tap performs (native a11y addition).
    public static var collapseHint: String {
        string("accordion.collapseHint", "Collapse section")
    }

    /// VoiceOver value announced when the section is expanded (web `aria-expanded={true}`).
    public static var expandedValue: String {
        string("accordion.expanded", "Expanded")
    }

    /// VoiceOver value announced when the section is collapsed (web `aria-expanded={false}`).
    public static var collapsedValue: String {
        string("accordion.collapsed", "Collapsed")
    }

    /// Title of the empty-body leaf, shown when the section is expanded with nothing to reveal, so the
    /// surface never renders a bare box (native HIG; the web simply renders empty children).
    public static var emptyTitle: String {
        string("accordion.empty", "No details to show")
    }

    /// Supporting line of the empty-body leaf.
    public static var emptyMessage: String {
        string("accordion.emptyMessage", "Details appear here when they become available.")
    }

    /// The hint for the current state — collapse when open, expand when closed.
    public static func toggleHint(isOpen: Bool) -> String {
        isOpen ? collapseHint : expandHint
    }

    /// The value for the current state — expanded when open, collapsed when closed.
    public static func stateValue(isOpen: Bool) -> String {
        isOpen ? expandedValue : collapsedValue
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core diagnostics sink
/// (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol AccordionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogAccordionTelemetry: AccordionTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - AccordionModel (P1/S8) — interaction state + derivation

/// The surface's observable state-holder. It owns the current ``AccordionInput`` (the web props) + the
/// uncontrolled `internalOpen` flag (web `useState(defaultOpen)`), derives the pure ``AccordionProjection``
/// as an observed read (SwiftUI observation replaces the React re-render), routes header taps through the
/// web `setOpen` rule (controlled → the page's `onOpenChange`; uncontrolled → the local flag), and emits
/// `view.opened` exactly once per instance. The web component has no fetcher, so neither does this holder.
@MainActor
@Observable
public final class AccordionModel {
    /// The current props (web `props`). Reading it (or the derived projection) registers an observation
    /// dependency, so the surface re-renders when the props change.
    public private(set) var input: AccordionInput

    /// The uncontrolled open flag (web `internalOpen`), seeded from `defaultOpen`. Authoritative only when
    /// the surface is uncontrolled; observed so the disclosure animates when it flips.
    public private(set) var internalOpen: Bool

    @ObservationIgnored private var onOpenChange: (@MainActor (Bool) -> Void)?
    @ObservationIgnored private let telemetry: any AccordionTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: AccordionInput,
        onOpenChange: (@MainActor (Bool) -> Void)? = nil,
        telemetry: any AccordionTelemetry = OSLogAccordionTelemetry()
    ) {
        self.input = input
        internalOpen = input.defaultOpen
        self.onOpenChange = onOpenChange
        self.telemetry = telemetry
    }

    /// The resolved, view-ready disclosure (web render output) — a pure function of the props + the local
    /// open flag.
    public var projection: AccordionProjection {
        AccordionProjector.resolve(input: input, internalOpen: internalOpen)
    }

    /// The resolved open state (web `open`).
    public var isOpen: Bool {
        projection.isOpen
    }

    /// Sets the open state — the verbatim port of the web `setOpen`: when controlled the page owns the
    /// state, so route the request out through `onOpenChange` and leave the local flag untouched (the new
    /// value flows back as a prop); when uncontrolled, flip the local flag.
    public func setOpen(_ next: Bool) {
        if input.isControlled {
            onOpenChange?(next)
        } else {
            internalOpen = next
        }
    }

    /// Toggles the open state — the web `onClick={() => setOpen(!open)}`.
    public func toggle() {
        setOpen(AccordionProjector.nextOpen(current: isOpen))
    }

    /// Replaces the props + the page closure — the native peer of React re-rendering with new props. The
    /// closure is always refreshed (it is recreated each parent render); the props reassign only when they
    /// actually change so an unrelated re-render does not invalidate observers spuriously. `defaultOpen` is
    /// initial-only (web `useState(defaultOpen)`), so it never resets `internalOpen` after mount — only the
    /// controlled `controlledOpen` flows through and re-derives the projection.
    public func update(_ input: AccordionInput, onOpenChange: (@MainActor (Bool) -> Void)?) {
        self.onOpenChange = onOpenChange
        if input != self.input {
            self.input = input
        }
    }

    /// Begins the surface and emits `view.opened` once. Idempotent across the SwiftUI appear/disappear
    /// churn — the event fires a single time per model instance.
    public func start() {
        guard !started else { return }
        started = true
        if !didEmitOpen {
            didEmitOpen = true
            telemetry.viewOpened(surface: AccordionSurface.slug)
        }
    }

    /// Marks the surface inactive. Symmetric with ``start()``; the once-only `view.opened` contract is
    /// preserved (a later ``start()`` does not re-emit).
    public func stop() {
        started = false
    }
}
