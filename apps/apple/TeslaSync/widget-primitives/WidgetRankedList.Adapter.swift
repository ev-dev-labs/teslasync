//
//  WidgetRankedList.Adapter.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The Foundation-only core for the ranked list — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetRankedList.tsx`. This file owns the surface identity (the
//  diagnostics slug), the row value type (``RankedItem``, the native peer of the web `RankedItem`), its
//  badge / bar sub-types, the connectivity axis, the view-ready row (``RankedListRow``), and the pure
//  ``WidgetRankedListArrange`` that ports the web render math (the `maxItems ?? (compact ? 3 : 5)` limit,
//  the `sort((a, b) => b.value - a.value)` descending slice, the `maxValue` reduce, the
//  `value / maxValue` bar fraction, the `compact || !showBars` bar hide). No SwiftUI and no `@Observable`,
//  so every rule is unit-testable in isolation.
//
//  Parity note: the web `<WidgetRankedList>` is a PURE presentational primitive — a shared widget building
//  block. It takes its data as plain props (`items`, `maxItems`, `compact`, `showBars`, `emptyMessage`,
//  `emptyIcon`) and renders, with no fetch / React-Query / Promise, so its OWN render has exactly two
//  branches: the ordered list (`visible.map(...)`) and the empty leaf (`visible.length === 0` →
//  `<EmptyState message="No data available" />`). The native peer reproduces BOTH and — exactly as the
//  sibling list primitive WidgetEventFeed (0005) — wraps them in the P4 host-lifecycle leaf contract
//  (loading / error / stale / offline) so a dashboard-widget host can wire its query lifecycle without the
//  primitive ever hiding. Those leaf states are the host wrapper, NOT invented web branches.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetRankedListSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetRankedList"
}

// MARK: - SF Symbols (web lucide / emptyIcon defaults)

/// The SF Symbols the surface defaults to. `emptyIcon` is the leading glyph for the empty leaf when the
/// caller passes no `emptyIcon` (web optional `emptyIcon`); `errorIcon` / `staleIcon` name the leaf-
/// contract glyphs. Kept as constants so they are asserted without rendering.
public enum WidgetRankedListSymbols {
    /// Default empty-leaf glyph (web optional `emptyIcon`).
    public static let empty = "list.number"
    /// Feed-failure glyph (P4 error leaf).
    public static let error = "exclamationmark.triangle.fill"
}

// MARK: - RankedBadgeTone (web `badge.variant: 'success' | 'warning' | 'error' | 'neutral'`)

/// The semantic variant of a row's badge — the native peer of the web `RankedItem.badge.variant`
/// (`success | warning | error | neutral`). The web maps it through `badgeVariantMap` to the `Badge`
/// component's variants (`error → danger`); the native view maps each case to the shared `TSTone` palette
/// (P1/S9) so the chip recolors across light / dark / high-contrast — no Tailwind ports, no raw hex.
public enum RankedBadgeTone: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case error
    case neutral
}

// MARK: - RankedBadge (web `badge: { text, variant }`)

/// A row's trailing badge — the native peer of the web `RankedItem.badge`. The web renders the chip only
/// when `item.badge` is present, so a present ``RankedBadge`` is the web "badge present" case and `nil` is
/// the "render no chip" case. `text` is a caller-supplied, already-localized runtime string rendered
/// verbatim (web `{item.badge.text}`).
public struct RankedBadge: Sendable, Equatable {
    /// The chip's text (web `badge.text`) — already localized by the caller, rendered verbatim.
    public let text: String
    /// The chip's semantic variant (web `badge.variant`) — selects the token tint.
    public let tone: RankedBadgeTone

    public init(text: String, tone: RankedBadgeTone) {
        self.text = text
        self.tone = tone
    }
}

// MARK: - RankedBarTone (web `barColor?: string`)

/// The semantic color of a row's magnitude bar — the native, theme-aware projection of the web
/// `barColor?: string` className passthrough (default `bg-blue-400`). The web forwards an arbitrary
/// Tailwind class; porting raw classes is forbidden (no Tailwind ports), so — exactly as the sibling
/// primitives map `valueColor` / `color` to design tokens — this enum maps the bar's intent to a P1/S9
/// token. The `nil`-equivalent default is ``accent`` (the brand bar tint, the peer of the web blue
/// default).
public enum RankedBarTone: String, Sendable, Equatable, CaseIterable {
    case accent
    case success
    case warning
    case danger
    case info
    case neutral
}

// MARK: - RankedItem (web `RankedItem`)

/// One ranked row's data — the native peer of the web `RankedItem` interface. `id` is the stable identity
/// (web `id: string | number`, stringified by the host); `label` is the caller-supplied, already-localized
/// name rendered verbatim; `value` is the numeric magnitude the list sorts + scales the bar by (web
/// `value: number`); `formattedValue` is the already-formatted display string shown on the right (web
/// `formattedValue`, formatted by the caller at the display boundary per the SI-cutover unit rules);
/// `badge` is the optional trailing chip (web `badge?`); `barTone` is the bar's semantic color (web
/// `barColor?`, defaulting to ``RankedBarTone/accent``).
public struct RankedItem: Identifiable, Sendable, Equatable {
    /// Stable identity (web `id`), stringified by the host.
    public let id: String
    /// The row label (web `label`) — already localized, rendered verbatim.
    public let label: String
    /// The numeric magnitude (web `value`) — drives the descending sort + the bar fraction.
    public let value: Double
    /// The already-formatted display string (web `formattedValue`) shown on the right.
    public let formattedValue: String
    /// The optional trailing badge (web `badge?`); `nil` renders no chip.
    public let badge: RankedBadge?
    /// The bar's semantic color (web `barColor?`), defaulting to ``RankedBarTone/accent``.
    public let barTone: RankedBarTone

    public init(
        id: String,
        label: String,
        value: Double,
        formattedValue: String,
        badge: RankedBadge? = nil,
        barTone: RankedBarTone = .accent
    ) {
        self.id = id
        self.label = label
        self.value = value
        self.formattedValue = formattedValue
        self.badge = badge
        self.barTone = barTone
    }
}

// MARK: - Connectivity (P4 connectivity axis)

/// The freshness of the data the rows are read over — the native mirror of the live / stale / offline
/// axis. `live` shows neither chip nor auto-refresh; `stale` / `offline` surface the freshness chip above
/// the list (the rows may be out of date) without hiding the surface.
public enum WidgetRankedListConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - RankedListRow (view-ready)

/// A resolved, view-ready row — the arranged ``RankedItem`` plus its 1-based `rank` (web `index + 1`) and
/// the `barFraction` (web `barPct / 100`, clamped to `0...1`). A pure passthrough so the view does no
/// layout math; `id` mirrors the item id for the SwiftUI `ForEach` (web `key={item.id}`).
public struct RankedListRow: Identifiable, Sendable, Equatable {
    /// Stable identity for `ForEach` (web `key={item.id}`).
    public var id: String {
        item.id
    }

    /// The 1-based display rank (web `index + 1`).
    public let rank: Int
    /// The row's data (web item), rendered by the SwiftUI row.
    public let item: RankedItem
    /// The bar width as a fraction `0...1` (web `barPct / 100`).
    public let barFraction: Double

    public init(rank: Int, item: RankedItem, barFraction: Double) {
        self.rank = rank
        self.item = item
        self.barFraction = barFraction
    }
}

// MARK: - Arrange (web limit + sort-desc slice + maxValue + bar fraction)

/// The pure arrange step — the native parity of the web component's `useMemo`s: resolve the limit
/// (`maxItems ?? (compact ? 3 : 5)`), sort the items by `value` descending (stable on ties so the input
/// order is preserved), slice to the limit, compute `maxValue` (the web `reduce(max, 0)`), and project each
/// visible item to a ``RankedListRow`` with its 1-based rank + clamped bar fraction. No clock, no store —
/// unit tested directly.
public enum WidgetRankedListArrange {
    /// The default visible count — web `compact ? 3 : 5`.
    public static func defaultLimit(compact: Bool) -> Int {
        compact ? 3 : 5
    }

    /// The resolved limit — web `maxItems ?? (compact ? 3 : 5)`.
    public static func limit(compact: Bool, maxItems: Int?) -> Int {
        maxItems ?? defaultLimit(compact: compact)
    }

    /// Whether the bars are hidden — web `compact || !showBars`.
    public static func hideBars(compact: Bool, showBars: Bool) -> Bool {
        compact || !showBars
    }

    /// The visible items — sorted by `value` descending (stable) and sliced to the resolved limit (web
    /// `[...items].sort((a, b) => b.value - a.value).slice(0, limit)`).
    public static func visible(_ items: [RankedItem], compact: Bool, maxItems: Int?) -> [RankedItem] {
        let cap = max(0, limit(compact: compact, maxItems: maxItems))
        let sorted = items.enumerated().sorted { lhs, rhs in
            if lhs.element.value == rhs.element.value {
                return lhs.offset < rhs.offset
            }
            return lhs.element.value > rhs.element.value
        }
        return sorted.prefix(cap).map(\.element)
    }

    /// The maximum value among the visible items — the web `visible.reduce((max, item) =>
    /// Math.max(max, item.value), 0)` (seeded at 0, so the result is never negative).
    public static func maxValue(_ items: [RankedItem]) -> Double {
        items.reduce(0) { Swift.max($0, $1.value) }
    }

    /// The bar fraction for one value — web `maxValue > 0 ? (value / maxValue) : 0`, clamped to `0...1`
    /// (the web width caps at 100%; a negative value clamps to 0).
    public static func barFraction(value: Double, maxValue: Double) -> Double {
        guard maxValue > 0 else { return 0 }
        return Swift.min(1, Swift.max(0, value / maxValue))
    }

    /// The view-ready rows — the visible items projected to ``RankedListRow`` with their 1-based rank (web
    /// `index + 1`) and clamped bar fraction (web `barPct`). The single entry point the projection calls.
    public static func rows(_ items: [RankedItem], compact: Bool, maxItems: Int?) -> [RankedListRow] {
        let shown = visible(items, compact: compact, maxItems: maxItems)
        let peak = maxValue(shown)
        return shown.enumerated().map { index, item in
            RankedListRow(
                rank: index + 1,
                item: item,
                barFraction: barFraction(value: item.value, maxValue: peak)
            )
        }
    }
}
