//
//  Accordion.Adapter.swift
//  TeslaSync — P4 shared surface · 0203 · Accordion (Apple)
//
//  The Foundation-only core for the collapsible section — the SwiftUI parity of
//  `components/ui/Accordion.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the props value type (``AccordionInput``), the view-ready ``AccordionProjection``, and the
//  pure ``AccordionProjector`` that resolves the open state (the web `isControlled ? openProp :
//  internalOpen`) and derives the chevron rotation / body visibility / accessibility-expanded flag. No
//  SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<Accordion>` is a PURE presentational primitive. It takes its data as
//  plain props (`title`, `children`, `defaultOpen`, the controlled `open` + `onOpenChange`, `icon`,
//  `badge`, `headerExtra`) and renders a header button over an animated body — there is no fetch, no
//  React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch (there is
//  nothing to fetch, fail, age, or lose connectivity to; the hosted `children` own their own data states).
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces only
//  the source's REAL branches — exactly as the sibling presentational primitives Delta (0081), MetricCard
//  (0095), InlineCallout (0124), ActiveFilterChips (0147), and StaggerItem (0194) did. The real branches:
//  collapsed (header only), expanded (header + animated body), controlled vs uncontrolled open resolution,
//  the optional icon / badge / headerExtra header regions, and the native "never a blank box" empty body.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum AccordionSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "Accordion"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. The web
/// `<Accordion>` is anonymous (its `title` is a caller-supplied, already-localized prop and it calls no
/// `t()` of its own), so the only strings this surface owns are the native a11y additions (the expand /
/// collapse hint, the expanded / collapsed value, and the empty-body leaf). Kept as a plain closure so the
/// pure core has no dependency on a bundle: the production app passes the P1/S10 facade, tests an identity
/// resolver.
public typealias AccordionResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - AccordionInput (web props, closure-free)

/// The component's props — the native peer of `AccordionProps`, minus the `children` / `icon` / `badge` /
/// `headerExtra` view content and the `onOpenChange` closure (held by the view + the state-holder). A value
/// type so the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI
/// `.onChange` can detect a prop change cheaply when the page rebinds (e.g. a new controlled `open`).
public struct AccordionInput: Sendable, Equatable {
    /// The header label (web `title`) — caller-supplied + already localized, rendered verbatim.
    public let title: String
    /// The initial open state when uncontrolled (web `defaultOpen`, default `false`). Initial-only —
    /// like the web `useState(defaultOpen)` it never resets the open state after first render.
    public let defaultOpen: Bool
    /// Whether the page drives the open state (web `open !== undefined && onOpenChange !== undefined`).
    public let isControlled: Bool
    /// The page-owned open value, meaningful only when ``isControlled`` (web `openProp`).
    public let controlledOpen: Bool
    /// Whether a leading icon region is rendered (web `icon != null`).
    public let hasIcon: Bool
    /// Whether a trailing badge region is rendered (web `badge != null`).
    public let hasBadge: Bool
    /// Whether a header-extra region is rendered after the badge (web `headerExtra != null`).
    public let hasHeaderExtra: Bool

    public init(
        title: String,
        defaultOpen: Bool = false,
        isControlled: Bool = false,
        controlledOpen: Bool = false,
        hasIcon: Bool = false,
        hasBadge: Bool = false,
        hasHeaderExtra: Bool = false
    ) {
        self.title = title
        self.defaultOpen = defaultOpen
        self.isControlled = isControlled
        self.controlledOpen = controlledOpen
        self.hasIcon = hasIcon
        self.hasBadge = hasBadge
        self.hasHeaderExtra = hasHeaderExtra
    }
}

// MARK: - AccordionProjection (view-ready)

/// The resolved, view-ready disclosure — everything the SwiftUI body needs as a pure function of the props
/// + the current uncontrolled open flag (no derivation in the view). `isOpen` is the web `open`;
/// `showsBody` is the web `{open && <motion.div>}`; `chevronRotationDegrees` is the web `open &&
/// 'rotate-180'`; `accessibilityExpanded` is the web `aria-expanded={open}`.
public struct AccordionProjection: Sendable, Equatable {
    /// The resolved open state (web `open`).
    public let isOpen: Bool
    /// Whether the body region renders (web `{open && ...}`).
    public let showsBody: Bool
    /// The chevron rotation in degrees — `180` when open, `0` when closed (web `rotate-180`).
    public let chevronRotationDegrees: Double
    /// The accessibility expanded state (web `aria-expanded`).
    public let accessibilityExpanded: Bool

    public init(
        isOpen: Bool,
        showsBody: Bool,
        chevronRotationDegrees: Double,
        accessibilityExpanded: Bool
    ) {
        self.isOpen = isOpen
        self.showsBody = showsBody
        self.chevronRotationDegrees = chevronRotationDegrees
        self.accessibilityExpanded = accessibilityExpanded
    }
}

// MARK: - AccordionProjector (web render body)

/// The pure projection from the props + the uncontrolled open flag to the view-ready model — the surface's
/// data adapter in the "state → projection" sense the acceptance calls for: it takes the props a page
/// already holds plus the local open flag (no fetch, no clock) and derives the rendered disclosure. Unit
/// tested across the controlled / uncontrolled open resolution, the chevron rotation, the toggle, and the
/// body-visibility flag.
public enum AccordionProjector {
    /// The chevron rotation when open — the web `rotate-180`.
    public static let openChevronDegrees: Double = 180
    /// The chevron rotation when closed — the web resting state.
    public static let closedChevronDegrees: Double = 0

    /// Resolves the open state — the verbatim port of the web `open = isControlled ? openProp :
    /// internalOpen`. When the page owns the state the local flag is ignored; otherwise the local flag
    /// (seeded from `defaultOpen`) is authoritative.
    public static func resolvedOpen(input: AccordionInput, internalOpen: Bool) -> Bool {
        input.isControlled ? input.controlledOpen : internalOpen
    }

    /// The chevron rotation for an open state — `180°` when open, `0°` when closed (web `rotate-180`).
    public static func chevronRotationDegrees(isOpen: Bool) -> Double {
        isOpen ? openChevronDegrees : closedChevronDegrees
    }

    /// The next open state for a header tap — the web `setOpen(!open)`.
    public static func nextOpen(current: Bool) -> Bool {
        !current
    }

    /// Resolves the whole disclosure from the props + the local open flag — the native peer of the web
    /// component's render decision.
    public static func resolve(input: AccordionInput, internalOpen: Bool) -> AccordionProjection {
        let open = resolvedOpen(input: input, internalOpen: internalOpen)
        return AccordionProjection(
            isOpen: open,
            showsBody: open,
            chevronRotationDegrees: chevronRotationDegrees(isOpen: open),
            accessibilityExpanded: open
        )
    }
}
