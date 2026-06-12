//
//  WidgetTipCards.Adapter.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The Foundation-only core for the tip cards — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetTipCards.tsx`. This file owns the surface identity (the
//  diagnostics slug), the impact level (``TipImpact``, the native peer of the web `'high' | 'medium' |
//  'low'` union), the tip value type (``TipItem``, the native peer of the web `TipItem`), the props
//  (``WidgetTipCardsInput``), the view-ready row (``TipRow``), the resolved ``WidgetTipCardsProjection``,
//  and the pure ``WidgetTipCardsProjector`` that ports the web render decision (the
//  `maxTips ?? (compact ? 1 : 3)` limit, the `tips.slice(0, limit)` cap, the `compact && line-clamp-2`
//  description clamp, and the `visible.length === 0` empty branch). No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetTipCards>` is a PURE presentational primitive — a shared widget
//  building block. It takes its data as plain props (`tips`, `maxTips`, `compact`, `emptyMessage`,
//  `emptyIcon`) and renders a list of tip cards, with no fetch, no React-Query cache, and no Promise, so it
//  has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to — the host widget that owns the query renders those). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces only the source's REAL branches —
//  exactly as the sibling presentational primitives WidgetComparisonCard (0003), Delta (0081),
//  MetricCard (0095), and Accordion (0203) did. The real branches: the populated list (one ``TipRow`` per
//  visible tip, each an optional leading glyph + title + optional impact badge + description) and the empty
//  leaf (the web `visible.length === 0` → the friendly `<EmptyState>`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetTipCardsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetTipCards"
}

// MARK: - TipImpact (web `'high' | 'medium' | 'low'`)

/// A tip's impact level — the native peer of the web `impact?: 'high' | 'medium' | 'low'` union. Drives
/// the badge tone (resolved in the view: high → success, medium → warning, low → neutral, the web
/// `impactBadgeMap`) and the badge's default localized label when the caller supplies no `impactLabel`.
public enum TipImpact: String, Sendable, Equatable, CaseIterable {
    case high
    case medium
    case low
}

// MARK: - TipItem (web `TipItem`)

/// One tip's data — the native peer of the web `TipItem` interface. `id` is the caller-supplied stable
/// identity (the web `string | number`, narrowed to `String` for the SwiftUI `ForEach`); `iconSymbol` is
/// the optional leading SF Symbol name (the native peer of the web `icon?: ReactNode`, which cannot port
/// an arbitrary node — the caller supplies a symbol); `title` / `description` are caller-supplied,
/// already-localized prose rendered verbatim; `impact` / `impactLabel` are the optional badge inputs (web
/// `impact?` / `impactLabel?`).
public struct TipItem: Sendable, Equatable, Identifiable {
    /// Stable identity for `ForEach` (web `key={tip.id}`).
    public let id: String
    /// Optional leading SF Symbol name (web `icon?`); `nil` renders no glyph.
    public let iconSymbol: String?
    /// The tip title (web `title`) — already localized, rendered verbatim.
    public let title: String
    /// The tip body (web `description`) — already localized, rendered verbatim.
    public let description: String
    /// Optional impact level (web `impact?`); `nil` renders no badge.
    public let impact: TipImpact?
    /// Optional caller-supplied badge label (web `impactLabel?`); falls back to the localized impact name.
    public let impactLabel: String?

    public init(
        id: String,
        iconSymbol: String? = nil,
        title: String,
        description: String,
        impact: TipImpact? = nil,
        impactLabel: String? = nil
    ) {
        self.id = id
        self.iconSymbol = iconSymbol
        self.title = title
        self.description = description
        self.impact = impact
        self.impactLabel = impactLabel
    }
}

// MARK: - WidgetTipCardsInput (web props)

/// The component's props — the native peer of `WidgetTipCardsProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when a reused card rebinds.
public struct WidgetTipCardsInput: Sendable, Equatable {
    /// The tips to render (web `tips`). An empty (or fully sliced-away) list resolves to the empty branch.
    public let tips: [TipItem]
    /// The optional explicit cap (web `maxTips?`); `nil` defers to the compact-aware default.
    public let maxTips: Int?
    /// Whether to render the condensed variant — one tip, clamped description (web `compact`).
    public let compact: Bool
    /// The optional empty-state message override (web `emptyMessage?`); `nil` uses the localized default.
    public let emptyMessage: String?
    /// The optional empty-state SF Symbol override (web `emptyIcon?`); `nil` uses the default glyph.
    public let emptyIconSymbol: String?

    public init(
        tips: [TipItem],
        maxTips: Int? = nil,
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil
    ) {
        self.tips = tips
        self.maxTips = maxTips
        self.compact = compact
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
    }
}

// MARK: - TipRow (view-ready)

/// A resolved, view-ready tip — everything the SwiftUI card needs as a pure function of a ``TipItem`` plus
/// the props (no derivation in the view). `descriptionLineLimit` is the resolved clamp (web
/// `compact && 'line-clamp-2'` → `2` when compact, `nil` for unlimited otherwise); `id` is the caller's
/// stable identity carried through for the SwiftUI `ForEach`.
public struct TipRow: Sendable, Equatable, Identifiable {
    /// Stable identity for `ForEach` (web `key={tip.id}`).
    public let id: String
    /// Optional leading SF Symbol name (web `icon?`).
    public let iconSymbol: String?
    /// The tip title (web `title`).
    public let title: String
    /// The tip body (web `description`).
    public let description: String
    /// Optional impact level (web `impact?`) — drives the badge tone + default label.
    public let impact: TipImpact?
    /// Optional caller-supplied badge label override (web `impactLabel?`).
    public let impactLabel: String?
    /// The resolved description line clamp (web `compact && line-clamp-2`): `2` when compact, else `nil`.
    public let descriptionLineLimit: Int?

    public init(
        id: String,
        iconSymbol: String?,
        title: String,
        description: String,
        impact: TipImpact?,
        impactLabel: String?,
        descriptionLineLimit: Int?
    ) {
        self.id = id
        self.iconSymbol = iconSymbol
        self.title = title
        self.description = description
        self.impact = impact
        self.impactLabel = impactLabel
        self.descriptionLineLimit = descriptionLineLimit
    }
}

// MARK: - WidgetTipCardsProjection (web render output)

/// The resolved render decision — the two real branches of the web source: the populated list (one
/// ``TipRow`` per visible tip) or the empty leaf (web `visible.length === 0`).
public enum WidgetTipCardsProjection: Sendable, Equatable {
    /// No visible tips — the web `<EmptyState>` branch.
    case empty
    /// One or more visible rows — the web `visible.map(...)` list.
    case populated([TipRow])
}

// MARK: - WidgetTipCardsProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) and derives the rendered list. Unit tested across the limit resolution, the `compact` slice,
/// the line-clamp, the row mapping, and the empty branch.
public enum WidgetTipCardsProjector {
    /// The default cap when `maxTips` is omitted and not compact — the web `3`.
    public static let defaultLimit = 3
    /// The default cap when `maxTips` is omitted and compact — the web `1`.
    public static let compactLimit = 1

    /// The resolved cap — the verbatim port of `maxTips ?? (compact ? 1 : 3)`, floored at `0` so a
    /// non-positive `maxTips` simply yields the empty branch rather than tripping `prefix`'s precondition.
    public static func limit(_ input: WidgetTipCardsInput) -> Int {
        let resolved = input.maxTips ?? (input.compact ? compactLimit : defaultLimit)
        return max(0, resolved)
    }

    /// The visible tips — the verbatim port of `tips.slice(0, limit)`.
    public static func visibleTips(_ input: WidgetTipCardsInput) -> [TipItem] {
        Array(input.tips.prefix(limit(input)))
    }

    /// Builds the view-ready rows from the props — the web `visible.map((tip) => …)`. The description clamp
    /// is the web `compact && 'line-clamp-2'`.
    public static func rows(_ input: WidgetTipCardsInput) -> [TipRow] {
        let lineLimit: Int? = input.compact ? 2 : nil
        return visibleTips(input).map { tip in
            TipRow(
                id: tip.id,
                iconSymbol: tip.iconSymbol,
                title: tip.title,
                description: tip.description,
                impact: tip.impact,
                impactLabel: tip.impactLabel,
                descriptionLineLimit: lineLimit
            )
        }
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render.
    public static func resolve(_ input: WidgetTipCardsInput) -> WidgetTipCardsProjection {
        let resolvedRows = rows(input)
        return resolvedRows.isEmpty ? .empty : .populated(resolvedRows)
    }
}
