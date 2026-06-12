//
//  StickyChipBar.Adapter.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  The Foundation-only core for the in-page section nav — the SwiftUI parity of
//  `components/status/StickyChipBar.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the chip value type (``SectionChip`` — web `ChipItem`), the props value type
//  (``StickyChipBarInput``), the view-ready ``StickyChipBarProjection``, and the pure
//  ``StickyChipBarProjector`` that derives one from the other (plus the active-id rules: the web
//  `chips[0]?.id ?? ''` default and the "keep the active id valid when the chip set changes" rule the
//  browser gets for free by re-running its observer). No SwiftUI and no `@Observable`, so every rule is
//  unit-testable in isolation.
//
//  Faithful-parity note: the web `<StickyChipBar>` is a PURE presentational component. It takes its data
//  as plain props (`chips`, `topOffset`, `className`) and renders — there is no fetch, no React-Query
//  cache, and no Promise — so it has NO loading, error, stale, or offline branch (there is nothing to
//  fetch, fail, age, or lose connectivity to; its only browser dependencies are `IntersectionObserver`
//  for active-section tracking and the scroll container for jump-to). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces only the source's REAL branches
//  — exactly as the sibling presentational primitives ActiveFilterChips (0147), InlineCallout (0124),
//  Delta (0081), and MetricCard (0095) did. The real branches are: the populated chip strip (one chip
//  active, the rest inactive) and the empty set (no chips) — which natively renders a friendly empty view
//  rather than the web's bare nav box, per the "never a blank surface" HIG rule. The two browser-only
//  facilities map to host seams: `IntersectionObserver` → ``StickyChipBarModel.reportVisibleSection(_:)``
//  fed by the host's scroll-spy, and the page scroll container → the page-supplied `onSelect` closure.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum StickyChipBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "StickyChipBar"
}

// MARK: - Localization facade seam (web label → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias StickyChipBarResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - SectionChip (web `ChipItem`)

/// One jump-to-section chip — the native peer of the web `ChipItem`. `id` is the anchor identity (web
/// `chip.id`, matched against the section the host scrolls to / observes); `label` is the user-facing
/// section name shown on the pill (web `chip.label`). A closure-free value type so the view, the
/// state-holder, and the pure projection agree on one `Equatable`/`Sendable` shape.
public struct SectionChip: Sendable, Equatable, Identifiable {
    /// Anchor identity (web `chip.id`).
    public let id: String
    /// The user-facing section name shown on the pill (web `chip.label`).
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - StickyChipBarInput (web props, closure-free)

/// The component's props — the native peer of `StickyChipBarProps`, minus the page-owned `onSelect`
/// closure (held by the state-holder) and the web-only `className` (no native analog). A value type so
/// the view, the state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange`
/// can detect a prop change cheaply when the page rebinds a fresh chip set.
public struct StickyChipBarInput: Sendable, Equatable {
    /// The ordered section chips (web `chips`).
    public let chips: [SectionChip]
    /// Points of inset from the top edge when the bar is pinned (web `topOffset`, default 0).
    public let topOffset: Double

    public init(chips: [SectionChip], topOffset: Double = 0) {
        self.chips = chips
        self.topOffset = topOffset
    }
}

// MARK: - StickyChipBarProjection (view-ready)

/// The resolved, view-ready strip — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view). `isEmpty` distinguishes the friendly empty view from a populated strip;
/// `defaultActiveID` is the web initial `useState(chips[0]?.id ?? '')`.
public struct StickyChipBarProjection: Sendable, Equatable {
    /// No chips are present (web `chips.length === 0`).
    public let isEmpty: Bool
    /// The ordered chips to render inline (web `chips`).
    public let chips: [SectionChip]
    /// The id selected by default (web `chips[0]?.id ?? ''`).
    public let defaultActiveID: String

    public init(isEmpty: Bool, chips: [SectionChip], defaultActiveID: String) {
        self.isEmpty = isEmpty
        self.chips = chips
        self.defaultActiveID = defaultActiveID
    }
}

// MARK: - StickyChipBarProjector (web render body + active-id rules)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "props → projection" sense the acceptance calls for: it takes the props a page already holds (no
/// fetch, no clock) and derives the rendered strip, the default active id (web `chips[0]?.id`), the
/// validity rule that keeps the active id pointing at a real chip when the set changes (what the browser
/// gets for free by re-running `IntersectionObserver`), and the active test. Unit tested across the empty
/// / populated boundary, the default, the validity rule, and the active test.
public enum StickyChipBarProjector {
    /// The id selected by default — the verbatim port of the web `useState(chips[0]?.id ?? '')`.
    public static func defaultActiveID(_ chips: [SectionChip]) -> String {
        chips.first?.id ?? ""
    }

    /// Whether the chip set still contains the given id (web: whether the observed anchor is still one of
    /// the chips).
    public static func contains(_ id: String, in chips: [SectionChip]) -> Bool {
        chips.contains { $0.id == id }
    }

    /// Keeps the active id valid: returns the requested id when it is still a real chip, else falls back
    /// to the default. The native peer of the browser re-running its observer over the new anchor set —
    /// without it a stale id (a removed section) would leave nothing highlighted.
    public static func resolveActiveID(requested: String, chips: [SectionChip]) -> String {
        contains(requested, in: chips) ? requested : defaultActiveID(chips)
    }

    /// Whether a chip is the active one (web `chip.id === activeId`).
    public static func isActive(_ id: String, activeID: String) -> Bool {
        id == activeID
    }

    /// Resolves the whole strip from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: StickyChipBarInput) -> StickyChipBarProjection {
        StickyChipBarProjection(
            isEmpty: input.chips.isEmpty,
            chips: input.chips,
            defaultActiveID: defaultActiveID(input.chips)
        )
    }
}
