//
//  WidgetDetailCard.Adapter.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The Foundation-only core for the detail card — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetDetailCard.tsx`. This file owns the surface identity (the
//  diagnostics slug), the badge variant (``DetailBadgeVariant``, the native peer of the web
//  `'success' | 'warning' | 'error' | 'neutral'` union), the badge value type (``DetailBadge``), the entry
//  value type (``DetailEntry``, the native peer of the web `DetailEntry`), the props
//  (``WidgetDetailCardInput``), the view-ready row (``DetailRow``), the resolved
//  ``WidgetDetailCardProjection``, and the pure ``WidgetDetailCardProjector`` that ports the web render
//  decision (the `entries.length === 0` empty branch evaluated BEFORE the slice, the
//  `compact ? entries.slice(0, 4) : entries` cap, and the `i < visible.length - 1` separator). No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<WidgetDetailCard>` is a PURE presentational primitive — a shared widget
//  building block. It takes its data as plain props (`entries`, `compact`, `emptyMessage`, `emptyIcon`) and
//  renders a scrollable column of label/value rows, with no fetch, no React-Query cache, and no Promise, so
//  it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to — the host widget that owns the query renders those). Inventing such chrome would
//  fabricate states the source does not have, so this surface reproduces only the source's REAL branches —
//  exactly as the sibling presentational primitives WidgetComparisonCard (0003), WidgetTipCards (0012),
//  Delta (0081), and MetricCard (0095) did. The real branches: the populated column (one ``DetailRow`` per
//  visible entry, hairline-separated), the `compact` slice (the first four entries), and the empty leaf
//  (the web `entries.length === 0` → the friendly `<EmptyState>`).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum WidgetDetailCardSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "WidgetDetailCard"
}

// MARK: - DetailBadgeVariant (web `'success' | 'warning' | 'error' | 'neutral'`)

/// A detail row badge's semantic variant — the native peer of the web
/// `badge.variant: 'success' | 'warning' | 'error' | 'neutral'`. The web maps it through `badgeVariantMap`
/// (`error → 'danger'`, the rest identity) before handing it to `<Badge>`; the native peer reproduces that
/// same two-step mapping in the view's ``DetailBadgeVariant/tone`` (`error → .danger`).
public enum DetailBadgeVariant: String, Sendable, Equatable, CaseIterable {
    case success
    case warning
    case error
    case neutral
}

// MARK: - DetailBadge (web `badge?: { text; variant }`)

/// A detail row's optional trailing badge — the native peer of the web
/// `badge?: { text: string; variant: … }`. `text` is caller-supplied + already localized (rendered
/// verbatim); `variant` selects the tinted tone.
public struct DetailBadge: Sendable, Equatable {
    /// The badge copy (web `badge.text`) — already localized, rendered verbatim.
    public let text: String
    /// The badge's semantic variant (web `badge.variant`) — drives the tone.
    public let variant: DetailBadgeVariant

    public init(text: String, variant: DetailBadgeVariant) {
        self.text = text
        self.variant = variant
    }
}

// MARK: - DetailEntry (web `DetailEntry`)

/// One detail row's data — the native peer of the web `DetailEntry` interface. `label` is the caller's
/// already-localized key, shown uppercased + muted; `value` is the caller's already-formatted display
/// value (the web `string | number | null`, narrowed to a pre-formatted `String?` since the host formats
/// numbers at the unit/display boundary) — `nil` renders the em-dash fallback, the web `value ?? '—'`;
/// `badge` is the optional trailing ``DetailBadge`` (web `badge?`); `mono` selects a monospaced value font
/// (web `mono` → `font-mono`).
public struct DetailEntry: Sendable, Equatable {
    /// The row label (web `label`) — already localized, rendered uppercased + verbatim.
    public let label: String
    /// The already-formatted display value (web `value`); `nil` renders the em-dash fallback (`value ?? '—'`).
    public let value: String?
    /// The optional trailing badge (web `badge?`); `nil` renders no badge.
    public let badge: DetailBadge?
    /// Whether the value uses a monospaced font (web `mono` → `font-mono`).
    public let mono: Bool

    public init(label: String, value: String?, badge: DetailBadge? = nil, mono: Bool = false) {
        self.label = label
        self.value = value
        self.badge = badge
        self.mono = mono
    }
}

// MARK: - WidgetDetailCardInput (web props)

/// The component's props — the native peer of `WidgetDetailCardProps`. A value type so the view, the
/// state-holder, and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop
/// change cheaply when a reused card rebinds.
public struct WidgetDetailCardInput: Sendable, Equatable {
    /// The detail rows to render (web `entries`). An empty array resolves to the empty branch.
    public let entries: [DetailEntry]
    /// Whether to render the condensed variant — the first four entries only (web `compact`).
    public let compact: Bool
    /// The optional empty-state message override (web `emptyMessage?`); `nil` uses the localized default.
    public let emptyMessage: String?
    /// The optional empty-state SF Symbol override (web `emptyIcon?`); `nil` uses the default glyph.
    public let emptyIconSymbol: String?

    public init(
        entries: [DetailEntry],
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil
    ) {
        self.entries = entries
        self.compact = compact
        self.emptyMessage = emptyMessage
        self.emptyIconSymbol = emptyIconSymbol
    }
}

// MARK: - DetailRow (view-ready)

/// A resolved, view-ready row — everything the SwiftUI row needs as a pure function of a ``DetailEntry``
/// plus its position (no derivation in the view). `id` is the stable positional identity for the SwiftUI
/// `ForEach` (more robust than the web `key={entry.label}`, which assumes unique labels); `isLast` drives
/// the hairline separator (web `i < visible.length - 1`).
public struct DetailRow: Sendable, Equatable, Identifiable {
    /// Stable positional identity for `ForEach` (the entry's index in the visible list).
    public let id: Int
    /// The row label (web `label`).
    public let label: String
    /// The already-formatted value (web `value`); `nil` renders the em-dash fallback.
    public let value: String?
    /// Whether the value uses a monospaced font (web `mono`).
    public let mono: Bool
    /// The optional trailing badge (web `badge?`).
    public let badge: DetailBadge?
    /// Whether this is the final visible row — suppresses the trailing separator (web `i < length - 1`).
    public let isLast: Bool

    public init(id: Int, label: String, value: String?, mono: Bool, badge: DetailBadge?, isLast: Bool) {
        self.id = id
        self.label = label
        self.value = value
        self.mono = mono
        self.badge = badge
        self.isLast = isLast
    }
}

// MARK: - WidgetDetailCardProjection (web render output)

/// The resolved render decision — the two real branches of the web source: the populated column (one
/// ``DetailRow`` per visible entry) or the empty leaf (web `entries.length === 0`).
public enum WidgetDetailCardProjection: Sendable, Equatable {
    /// No entries — the web `<EmptyState>` branch.
    case empty
    /// One or more visible rows — the web `visible.map(...)` column.
    case populated([DetailRow])
}

// MARK: - WidgetDetailCardProjector (web render body)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "state → projection" sense the acceptance calls for: it takes the props a host already holds (no fetch,
/// no clock) and derives the rendered column. Unit tested across the `compact` slice, the row mapping
/// (positional ids + `isLast`), and the empty branch.
public enum WidgetDetailCardProjector {
    /// The number of entries kept in `compact` mode — the web `entries.slice(0, 4)`.
    public static let compactLimit = 4

    /// The visible entries — the verbatim port of `compact ? entries.slice(0, 4) : entries`.
    public static func visibleEntries(_ input: WidgetDetailCardInput) -> [DetailEntry] {
        input.compact ? Array(input.entries.prefix(compactLimit)) : input.entries
    }

    /// Builds the view-ready rows from the props — the web `visible.map((entry, i) => …)`, carrying the
    /// positional id and the `isLast` separator flag (web `i < visible.length - 1`).
    public static func rows(_ input: WidgetDetailCardInput) -> [DetailRow] {
        let visible = visibleEntries(input)
        let lastIndex = visible.count - 1
        return visible.enumerated().map { index, entry in
            DetailRow(
                id: index,
                label: entry.label,
                value: entry.value,
                mono: entry.mono,
                badge: entry.badge,
                isLast: index == lastIndex
            )
        }
    }

    /// Resolves the whole render decision from the props — the native peer of the web component's render.
    /// The empty check mirrors the web `entries.length === 0`, evaluated on the RAW entries BEFORE the
    /// `compact` slice (the slice only ever narrows a non-empty list, so the two agree).
    public static func resolve(_ input: WidgetDetailCardInput) -> WidgetDetailCardProjection {
        guard !input.entries.isEmpty else { return .empty }
        return .populated(rows(input))
    }
}
