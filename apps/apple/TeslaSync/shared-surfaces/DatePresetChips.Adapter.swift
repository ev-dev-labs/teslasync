//
//  DatePresetChips.Adapter.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  The Foundation-only core for the quick-select date-range chip row — the SwiftUI parity of
//  `components/forms/DatePresetChips.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam (the native shape of the web `t(key, default)`), the resolved-range / selection value
//  types (the web `{ start, end }` + `DatePresetSelection`), the chip size (web `'sm' | 'md'`), the props
//  value type (``DatePresetChipsInput``), the view-ready ``DatePresetChipsProjection``, the preset catalog
//  (the 1:1 port of `web/src/lib/datePresets.ts` the web component consumes through `DATE_PRESETS` /
//  `DEFAULT_PRESET_IDS`), and the pure ``DatePresetChipsProjector`` that filters the catalog into the
//  rendered chips. No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<DatePresetChips>` is a PURE presentational component. It takes its data
//  as plain props (`presetIds`, `activeId`, `onSelect`, `size`, `ariaLabel`) and renders a row of `<Button>`
//  chips — there is no fetch, no React-Query cache, and no Promise — so it has NO loading, error, stale, or
//  offline branch (there is nothing to fetch, fail, age, or lose connectivity to; its only "hook" is
//  `useTranslation` and its only side effect is resolving the preset's range on tap via `new Date()`).
//  Inventing such chrome would fabricate states the source does not have, so this surface reproduces only
//  the source's REAL branches — exactly as the sibling presentational primitives ActiveFilterChips (0147)
//  and RangePicker's preset list (0157) did. The real branches are: the populated chip row (with an optional
//  active highlight per `activeId`) and the empty row (when `presetIds` resolves to zero known presets → a
//  friendly empty-state view, never a bare box).
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DatePresetChipsSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DatePresetChips"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// `@Sendable` closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver.
public typealias DatePresetChipsResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - DatePresetChipsSize (web `size?: 'sm' | 'md'`)

/// The chip size — the native peer of the web `size` prop, mapped onto the shared `TSButton` size scale at
/// the view boundary (`small`/`medium`). `small` is the web default.
public enum DatePresetChipsSize: String, Sendable, Equatable, CaseIterable {
    case small
    case medium
}

// MARK: - DatePresetChipsRange (web `DatePresetRange` `{ start, end }`)

/// A resolved, inclusive ISO date range (`YYYY-MM-DD` strings) — the native peer of the web
/// `DatePresetRange` returned by a preset's `resolve(now)`. A value type so the catalog, the state-holder,
/// and the tests all agree on one shape.
public struct DatePresetChipsRange: Sendable, Equatable {
    /// Inclusive start day (`YYYY-MM-DD`, web `start`).
    public let start: String
    /// Inclusive end day (`YYYY-MM-DD`, web `end`).
    public let end: String

    public init(start: String, end: String) {
        self.start = start
        self.end = end
    }
}

// MARK: - DatePresetChipsSelection (web `DatePresetSelection`)

/// The payload handed to the page's `onSelect` — the native peer of the web `DatePresetSelection`
/// `{ id, start, end }`: the tapped preset's id plus its freshly resolved inclusive range.
public struct DatePresetChipsSelection: Sendable, Equatable {
    /// The tapped preset's id (web `id`).
    public let id: String
    /// The resolved inclusive start day (`YYYY-MM-DD`, web `start`).
    public let start: String
    /// The resolved inclusive end day (`YYYY-MM-DD`, web `end`).
    public let end: String

    public init(id: String, start: String, end: String) {
        self.id = id
        self.start = start
        self.end = end
    }

    /// Bundle a `(id, range)` pair into a selection.
    public init(id: String, range: DatePresetChipsRange) {
        self.init(id: id, start: range.start, end: range.end)
    }
}

// MARK: - DatePresetChipsPreset (web `DatePreset`, closure-free)

/// One preset's metadata — the native peer of the web `DatePreset`, minus the `resolve` closure (resolution
/// is the pure ``DatePresetChipsCatalog/resolve(_:now:calendar:)`` keyed by `id`). `i18nKey` + `fallback`
/// carry the web `t(key, default)` pair so the label reads identically on both platforms.
public struct DatePresetChipsPreset: Sendable, Equatable, Identifiable {
    /// Stable identity (web `id`, e.g. `"7d"`).
    public let id: String
    /// The i18n key (web `i18nKey`, e.g. `"date.preset.last7"`).
    public let i18nKey: String
    /// The English fallback (web `fallback`, e.g. `"Last 7 days"`).
    public let fallback: String

    public init(id: String, i18nKey: String, fallback: String) {
        self.id = id
        self.i18nKey = i18nKey
        self.fallback = fallback
    }
}

// MARK: - DatePresetChipsInput (web props, closure-free)

/// The component's props — the native peer of `DatePresetChipsProps`, minus the `onSelect` closure (held by
/// the state-holder so this value stays `Equatable`/`Sendable`). A value type so the view, the state-holder,
/// and the pure projection agree on one shape, and so a SwiftUI `.onChange` can detect a prop change cheaply
/// when a page rebinds a new `activeId`.
public struct DatePresetChipsInput: Sendable, Equatable {
    /// The subset of preset ids to render (web `presetIds`, default ``DatePresetChipsCatalog/defaultIDs``).
    public let presetIDs: [String]
    /// The id of the currently active preset, highlighted as primary (web `activeId`).
    public let activeID: String?
    /// The chip size (web `size`, default `small`).
    public let size: DatePresetChipsSize
    /// An override for the group's accessible name (web `ariaLabel`); `nil` falls back to "Quick date range".
    public let ariaLabelOverride: String?

    public init(
        presetIDs: [String] = DatePresetChipsCatalog.defaultIDs,
        activeID: String? = nil,
        size: DatePresetChipsSize = .small,
        ariaLabelOverride: String? = nil
    ) {
        self.presetIDs = presetIDs
        self.activeID = activeID
        self.size = size
        self.ariaLabelOverride = ariaLabelOverride
    }
}

// MARK: - DatePresetChipsChip (one resolved, view-ready chip)

/// One rendered chip — a catalog preset paired with its active flag. `i18nKey` + `fallback` are resolved to
/// the visible label through the P1/S10 facade at the view boundary (web `t(p.i18nKey, p.fallback)`); the
/// pure core stays bundle-free so the projection is deterministic in tests.
public struct DatePresetChipsChip: Sendable, Equatable, Identifiable {
    /// Stable identity (web preset `id`).
    public let id: String
    /// The i18n key for the label (web `p.i18nKey`).
    public let i18nKey: String
    /// The English fallback for the label (web `p.fallback`).
    public let fallback: String
    /// Whether this chip is the active one — rendered primary vs ghost (web `p.id === activeId`).
    public let isActive: Bool

    public init(id: String, i18nKey: String, fallback: String, isActive: Bool) {
        self.id = id
        self.i18nKey = i18nKey
        self.fallback = fallback
        self.isActive = isActive
    }
}

// MARK: - DatePresetChipsProjection (view-ready)

/// The resolved, view-ready chip row — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view). `isEmpty` distinguishes the (shown) empty-state view from a populated row, the
/// native peer of the web rendering an empty `role="group"` div when `presetIds` matches nothing.
public struct DatePresetChipsProjection: Sendable, Equatable {
    /// No preset matched `presetIds` (web `presets.length === 0`).
    public let isEmpty: Bool
    /// The ordered chips to render — catalog order, deduped, unknown ids dropped (web `presets`).
    public let chips: [DatePresetChipsChip]

    public init(isEmpty: Bool, chips: [DatePresetChipsChip]) {
        self.isEmpty = isEmpty
        self.chips = chips
    }
}

// MARK: - DatePresetChipsProjector (web render body)

/// The pure projection from the props to the view-ready row — the surface's adapter in the "catalog →
/// projection" sense the acceptance calls for: it takes the props a page holds and the static catalog (no
/// fetch, no clock) and derives the rendered chips, replicating the web `DATE_PRESETS.filter(p =>
/// ids.has(p.id))` exactly — catalog order is preserved, the id set dedupes, and unknown ids are dropped.
public enum DatePresetChipsProjector {
    /// Resolves the whole row from the props — the native peer of the web component's render decision. Filters
    /// the catalog by the props' id set (preserving catalog order, deduping, dropping unknown ids) and marks
    /// the active chip.
    public static func resolve(_ input: DatePresetChipsInput) -> DatePresetChipsProjection {
        let ids = Set(input.presetIDs)
        let chips = DatePresetChipsCatalog.all
            .filter { ids.contains($0.id) }
            .map { preset in
                DatePresetChipsChip(
                    id: preset.id,
                    i18nKey: preset.i18nKey,
                    fallback: preset.fallback,
                    isActive: preset.id == input.activeID
                )
            }
        return DatePresetChipsProjection(isEmpty: chips.isEmpty, chips: chips)
    }
}
