//
//  UsageCard.Adapter.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The Foundation-only core for the "spend / volume" usage card — the SwiftUI parity of
//  components/data-display/UsageCard.tsx. This file holds the surface identity (the diagnostics slug),
//  the intent axis (``UsageCardIntent``, the native peer of the web `UsageCardIntent` union), the seven
//  composition value types the card forwards (the optional budget bar, the at-a-glance bands, the
//  key/value details, the top-list breakdowns, the callout banner, and the footer links), and the
//  props bundle (``UsageCardInput``). No SwiftUI and no `@Observable`, so every value type and every
//  derivation is unit-testable in isolation.
//
//  Faithful-parity note: the web `UsageCard` is a PURE presentational primitive — its own header
//  comment says so ("Pure presentational: no hooks, no API calls, no derived state. Every dynamic value
//  comes in via props"). It maps its props straight to a `<div>` of sections; there is no fetch, no
//  React-Query cache, and no Promise, so it has NO loading, error, stale, or offline branch (there is
//  nothing to load, fail, age, or lose connectivity to — its host owns those states). Inventing such
//  chrome would fabricate states the source does not have, so this surface reproduces only the source's
//  REAL branches — exactly as the sibling presentational primitives MetricCard (0095), Delta (0081),
//  and Accordion (0203) did. The real branches are:
//    • empty     — `!hasAnything` → the muted empty message (web `<p>{emptyMessage ?? '…'}</p>`).
//    • budget    — the optional progress bar (headline, right label, caption, clamped bar, intent).
//    • bands     — the optional 3-up at-a-glance grid, each band carrying its own intent.
//    • details   — the optional key/value grid, each value carrying its own intent.
//    • topLists  — the optional breakdown blocks (a header + a name/value list each).
//    • banner    — the optional callout (default danger intent, default warning glyph).
//    • footer    — the optional link row (internal vs external, primary vs secondary).
//
//  Composition seam: the web card renders raw `ReactNode` for every label / value / icon. In practice
//  (its two consumers, TeslaApiUsageCard + AiUsageCard) those are already-formatted strings + glyphs,
//  so — exactly like the sibling MetricCard — the native peer carries already-localized `String` copy
//  and optional SF Symbol names, keeping the value types `Sendable` + `Equatable` and trivially
//  testable. Number / unit / currency formatting is the format subsystem's job (web `fmt*` / `useUnits`),
//  applied before a value reaches this card, the same boundary the web consumers draw.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// The web component is named `UsageCard`; this surface keeps the same slug here (SwiftUI-free) so the
/// state-holder can emit telemetry without depending on the view layer.
public enum UsageCardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "UsageCard"
}

// MARK: - UsageCardIntent (web `UsageCardIntent`)

/// The visual intent driving the accent color for bars / bands / values / banners — the native peer of
/// the web `UsageCardIntent` union (`'normal' | 'warn' | 'danger'`). Mapped to theme-aware design tokens
/// (P1/S9) in UsageCard.Views.swift (`normal → accent`, `warn → statusWarning`, `danger → statusDanger`)
/// so every accent recolors across light / dark / high-contrast, where the web's fixed Tailwind shades
/// (`cyan-500` / `amber-500` / `red-500`) did not.
public enum UsageCardIntent: String, Sendable, Equatable, CaseIterable {
    /// The resting accent (web `normal` → cyan).
    case normal
    /// The warning accent (web `warn` → amber).
    case warn
    /// The danger accent (web `danger` → red).
    case danger

    /// The web default for bars / bands / details (`intent ?? 'normal'`).
    public static let defaultIntent: UsageCardIntent = .normal

    /// The web default for the callout banner (`banner.intent ?? 'danger'`) — most callouts here are
    /// warnings rather than informational, matching the source's banner default.
    public static let defaultBannerIntent: UsageCardIntent = .danger
}

// MARK: - UsageCardBudget (web `UsageCardBudget`)

/// The optional budget progress bar — the native peer of `UsageCardBudget`. The card hides this section
/// entirely when it is absent, so a consumer with no "spend cap" concept skips the bar without a layout
/// workaround. `pct` drives both the bar width (clamped 0…100) and the accessibility value (the
/// unclamped, rounded reading so an over-budget overflow is still announced) — the split the projector
/// reproduces from the web `widthPct` / `ariaValueNow`.
public struct UsageCardBudget: Sendable, Equatable {
    /// Pre-formatted "spent of total" headline, e.g. "$0.42 of $5.00" (web `headline`).
    public let headline: String
    /// Right-side caption, e.g. "8% of monthly credit" (web `rightLabel`); danger-colored when over.
    public let rightLabel: String?
    /// Caption under the bar, e.g. "Day 5 of 30 · resets in 25 days" (web `caption`).
    public let caption: String?
    /// 0…100 used for the bar width AND the rounded accessibility value (web `pct`).
    public let pct: Double
    /// Visual intent driving the bar color (web `intent`, default normal).
    public let intent: UsageCardIntent
    /// Short label naming the budget for screen readers — required (web `ariaLabel`).
    public let accessibilityLabel: String

    public init(
        headline: String,
        rightLabel: String? = nil,
        caption: String? = nil,
        pct: Double,
        intent: UsageCardIntent = .defaultIntent,
        accessibilityLabel: String
    ) {
        self.headline = headline
        self.rightLabel = rightLabel
        self.caption = caption
        self.pct = pct
        self.intent = intent
        self.accessibilityLabel = accessibilityLabel
    }
}

// MARK: - UsageCardBand (web `UsageCardBand`)

/// One at-a-glance band rendered in the bands grid — the native peer of `UsageCardBand`. The optional
/// `iconSystemName` sits to the left of the uppercase label; `value` is the large tabular headline; `sub`
/// is the small muted subtitle. `intent` adds a colored ring + tinted fill (web `intentBandRing`).
public struct UsageCardBand: Sendable, Equatable, Identifiable {
    /// Stable identity for the grid (web uses the array index `key`).
    public let id: String
    /// Optional leading SF Symbol (web decorative `icon` `ReactNode`).
    public let iconSystemName: String?
    /// The uppercase muted label (web `label`).
    public let label: String
    /// The large tabular-numeric headline (web `value`).
    public let value: String
    /// The optional muted subtitle line (web `sub`).
    public let sub: String?
    /// The band's visual intent — colored ring + tint (web `intent`, default normal).
    public let intent: UsageCardIntent

    public init(
        id: String,
        iconSystemName: String? = nil,
        label: String,
        value: String,
        sub: String? = nil,
        intent: UsageCardIntent = .defaultIntent
    ) {
        self.id = id
        self.iconSystemName = iconSystemName
        self.label = label
        self.value = value
        self.sub = sub
        self.intent = intent
    }
}

// MARK: - UsageCardDetail (web `UsageCardDetail`)

/// One key/value cell rendered in the detail grid — the native peer of `UsageCardDetail`. Used for
/// "useful requests / skipped polls / avg latency / error rate"-style pairs; `intent` colors the value
/// text (e.g. danger for a high error rate, web `intentValueText`).
public struct UsageCardDetail: Sendable, Equatable, Identifiable {
    /// Stable identity for the grid (web uses the array index `key`).
    public let id: String
    /// The muted caption label (web `label`).
    public let label: String
    /// The tabular value text, colored by `intent` (web `value`).
    public let value: String
    /// The value-text intent (web `intent`, default normal).
    public let intent: UsageCardIntent

    public init(
        id: String,
        label: String,
        value: String,
        intent: UsageCardIntent = .defaultIntent
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.intent = intent
    }
}

// MARK: - UsageCardTopListItem / UsageCardTopList (web `UsageCardTopList*`)

/// One row in a top-list breakdown — the native peer of `UsageCardTopListItem`. `label` is the
/// left-aligned name (rendered monospaced, web `font-mono`); `value` is the right-aligned count.
public struct UsageCardTopListItem: Sendable, Equatable, Identifiable {
    /// Stable identity (web `item.key`).
    public let id: String
    /// The monospaced, left-aligned name (web `label`).
    public let label: String
    /// The right-aligned tabular count (web `value`).
    public let value: String

    public init(id: String, label: String, value: String) {
        self.id = id
        self.label = label
        self.value = value
    }
}

/// One top-list block rendered in the breakdown grid — the native peer of `UsageCardTopList`. Each block
/// has its own optional icon + header and a name/value list.
public struct UsageCardTopList: Sendable, Equatable, Identifiable {
    /// Stable identity (web `tl.key`).
    public let id: String
    /// Optional leading SF Symbol next to the title (web decorative `icon`).
    public let iconSystemName: String?
    /// The uppercase muted block title (web `title`).
    public let title: String
    /// The block's rows (web `items`).
    public let items: [UsageCardTopListItem]

    public init(
        id: String,
        iconSystemName: String? = nil,
        title: String,
        items: [UsageCardTopListItem]
    ) {
        self.id = id
        self.iconSystemName = iconSystemName
        self.title = title
        self.items = items
    }
}

// MARK: - UsageCardBanner (web `UsageCardBanner`)

/// The optional callout banner rendered after the top-lists, before the footer — the native peer of
/// `UsageCardBanner`. Used for "over monthly credit"-style status messages. Defaults to danger intent
/// (most callouts here are warnings) and to the warning-triangle glyph when no override is supplied
/// (web `icon ?? <AlertTriangle/>`).
public struct UsageCardBanner: Sendable, Equatable {
    /// The default trailing glyph — the native peer of the web `AlertTriangle` fallback.
    public static let defaultIconSystemName = "exclamationmark.triangle"

    /// The bold banner title (web `title`).
    public let title: String
    /// The muted banner description line (web `description`).
    public let description: String
    /// The banner intent — drives fill / ring / text color (web `intent`, default danger).
    public let intent: UsageCardIntent
    /// Optional leading SF Symbol override; `nil` resolves to the warning triangle (web `icon`).
    public let iconSystemName: String?

    public init(
        title: String,
        description: String,
        intent: UsageCardIntent = .defaultBannerIntent,
        iconSystemName: String? = nil
    ) {
        self.title = title
        self.description = description
        self.intent = intent
        self.iconSystemName = iconSystemName
    }
}

// MARK: - UsageCardFooterLink (web `UsageCardFooterLink`)

/// One footer link — the native peer of `UsageCardFooterLink`. `external` links open the `destination`
/// URL in the system browser (web `<a target="_blank">`); internal links route through the host's
/// in-app navigation (web react-router `<Link to>`), surfaced via the view's `onNavigate` seam so the
/// value type stays closure-free + `Equatable`. `primary` renders the filled accent variant.
public struct UsageCardFooterLink: Sendable, Equatable, Identifiable {
    /// Stable identity (web `link.key`).
    public let id: String
    /// The link target — a URL string for external links, an in-app route for internal (web `to`).
    public let destination: String
    /// The link label (web `label`).
    public let label: String
    /// Whether to render the filled primary variant (web `primary`, default secondary).
    public let primary: Bool
    /// Whether the link opens externally in the browser (web `external`, default internal).
    public let external: Bool

    public init(
        id: String,
        destination: String,
        label: String,
        primary: Bool = false,
        external: Bool = false
    ) {
        self.id = id
        self.destination = destination
        self.label = label
        self.primary = primary
        self.external = external
    }
}

// MARK: - UsageCardInput (web props, closure-free)

/// The component's props — the native peer of `UsageCardProps`, minus the `onNavigate` closure (held by
/// the view + the state-holder) and the `className` passthrough (a web layout concern with no native
/// peer). A value type so the view, the state-holder, and the pure projection agree on one shape, and so
/// a SwiftUI `.onChange` can detect a prop change cheaply when a reused card rebinds. Every section is
/// optional, exactly like the source — an all-empty input renders the empty message.
public struct UsageCardInput: Sendable, Equatable {
    /// The optional budget progress bar (web `budget`).
    public let budget: UsageCardBudget?
    /// The at-a-glance bands (web `bands`, default none).
    public let bands: [UsageCardBand]
    /// The key/value detail cells (web `details`, default none).
    public let details: [UsageCardDetail]
    /// The top-list breakdown blocks (web `topLists`, default none).
    public let topLists: [UsageCardTopList]
    /// The optional callout banner (web `banner`).
    public let banner: UsageCardBanner?
    /// The footer links (web `footer`, default none).
    public let footer: [UsageCardFooterLink]
    /// Copy shown when no section is present; `nil` resolves to the localized default (web
    /// `emptyMessage ?? 'No data to display yet.'`).
    public let emptyMessage: String?

    public init(
        budget: UsageCardBudget? = nil,
        bands: [UsageCardBand] = [],
        details: [UsageCardDetail] = [],
        topLists: [UsageCardTopList] = [],
        banner: UsageCardBanner? = nil,
        footer: [UsageCardFooterLink] = [],
        emptyMessage: String? = nil
    ) {
        self.budget = budget
        self.bands = bands
        self.details = details
        self.topLists = topLists
        self.banner = banner
        self.footer = footer
        self.emptyMessage = emptyMessage
    }
}
