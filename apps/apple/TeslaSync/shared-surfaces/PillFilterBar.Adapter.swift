//
//  PillFilterBar.Adapter.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The Foundation-only core for the single-select pill / tab filter row — the SwiftUI parity of
//  `components/forms/PillFilterBar.tsx`. This file owns the surface identity (the diagnostics slug), the
//  accent + variant value enums, the closure-free pill value (``PillItem``), the props value type
//  (``PillFilterBarInput``), the view-ready ``ResolvedPill`` / ``PillFilterBarProjection``, and the pure
//  ``PillFilterBarProjector`` that maps the props into the projection AND implements the WAI-ARIA Tabs
//  keyboard math (Left/Right wrap-around skipping disabled pills, Home/End). No SwiftUI and no
//  `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<PillFilterBar>` is a PURE presentational component. It takes its data
//  as plain props (`items`, `activeKey`, `onChange`, `ariaLabel`, `variant`, `scrollable`) and renders;
//  its only hook is `useId` (a stable tablist id) — there is no fetch, no React-Query cache, and no
//  Promise. So it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age,
//  or lose connectivity to). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational
//  surfaces ActiveFilterChips (0147) and CurrencyInput (0150) did. The real branches are: the friendly
//  empty state (native — never a blank box), the `pills` variant (rounded chip with active fill,
//  ring, and selected dot), the `tabs` variant (bottom-border underline), and per-pill selected /
//  unselected / disabled / icon-present / count-present permutations, with optional horizontal scroll.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11).
/// Kept SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum PillFilterBarSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "PillFilterBar"
}

// MARK: - Localization facade seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a
/// plain closure so the pure core has no dependency on a bundle: the production app passes the P1/S10
/// facade, while tests pass an identity-fallback resolver. The web `<PillFilterBar>` itself holds no
/// `t()` calls (its labels arrive already-localized as props); the only facade-resolved string is the
/// native empty-group state.
public typealias PillFilterBarResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - PillAccent (web `PillItem['accent']`)

/// The pill's accent colour — the native peer of the web `accent?: 'cyan' | 'green' | 'amber' | 'red' |
/// 'purple' | 'blue'` union. The web defaults a missing accent to `cyan` (`item.accent ?? 'cyan'`); the
/// ``PillItem`` initializer mirrors that default so the value is never optional past the boundary. The
/// concrete SwiftUI colours live in the token-driven Views layer (P1/S9), keeping this enum Foundation-only.
public enum PillAccent: String, Sendable, CaseIterable {
    case cyan
    case green
    case amber
    case red
    case purple
    case blue

    /// The web fallback accent (`item.accent ?? 'cyan'`).
    public static let `default` = PillAccent.cyan
}

// MARK: - PillVariant (web `variant`)

/// The render style — the native peer of the web `variant?: 'pills' | 'tabs'`. `pills` (default) renders
/// rounded-full chips with an active fill, ring, and selected dot; `tabs` renders a flat row with a
/// bottom-border underline on the selected item.
public enum PillVariant: String, Sendable, CaseIterable {
    case pills
    case tabs
}

// MARK: - PillItem (web `PillItem`, closure-free)

/// One pill the page passes in — the native peer of the web `PillItem`. The web `<PillFilterBar>` raises a
/// single bar-level `onChange(key)` (there are no per-item closures), so unlike a chip strip this value is
/// fully closure-free and stays `Sendable`/`Equatable` without splitting out a descriptor. `key` matches
/// the web `key` (written to URL state, used for `onChange`); `iconSystemName` is the Apple-idiomatic
/// mapping of the web `icon?: ReactNode` (an optional SF Symbol name rendered as a leading glyph); `count`
/// renders as a muted `(12)` suffix; disabled pills are skipped during arrow navigation.
public struct PillItem: Sendable, Equatable, Identifiable {
    /// Stable identifier — written to URL state and used for `onChange` (web `key`).
    public let key: String
    /// Visible label, already localised by the page (web `label`).
    public let label: String
    /// Optional leading SF Symbol name — the native mapping of the web `icon?: ReactNode`.
    public let iconSystemName: String?
    /// Optional count rendered as a muted `(12)` suffix (web `count`).
    public let count: Int?
    /// Accent colour for the dot / active fill (web `accent`, defaulting to `cyan`).
    public let accent: PillAccent
    /// Disabled pills are skipped during arrow navigation (web `disabled`).
    public let disabled: Bool

    public var id: String {
        key
    }

    public init(
        key: String,
        label: String,
        iconSystemName: String? = nil,
        count: Int? = nil,
        accent: PillAccent = .default,
        disabled: Bool = false
    ) {
        self.key = key
        self.label = label
        self.iconSystemName = iconSystemName
        self.count = count
        self.accent = accent
        self.disabled = disabled
    }
}

// MARK: - PillFilterBarInput (web props, closure-free)

/// The component's props — the native peer of `PillFilterBarProps`, minus the `onChange` closure (held by
/// the state-holder). A value type so the view, the state-holder, and the pure projection agree on one
/// shape, and so a SwiftUI `.onChange` can detect a prop change cheaply when the page rebinds a fresh
/// active key or item set.
public struct PillFilterBarInput: Sendable, Equatable {
    /// The ordered pills (web `items`).
    public let items: [PillItem]
    /// The selected pill key (web `activeKey`).
    public let activeKey: String
    /// The localised label announced for the whole row (web `ariaLabel`).
    public let ariaLabel: String
    /// `pills` (default) or `tabs` (web `variant`).
    public let variant: PillVariant
    /// Allow horizontal scroll on overflow (web `scrollable`, default true).
    public let scrollable: Bool

    public init(
        items: [PillItem],
        activeKey: String,
        ariaLabel: String,
        variant: PillVariant = .pills,
        scrollable: Bool = true
    ) {
        self.items = items
        self.activeKey = activeKey
        self.ariaLabel = ariaLabel
        self.variant = variant
        self.scrollable = scrollable
    }
}

// MARK: - ResolvedPill (view-ready, one pill)

/// One pill resolved for rendering — the original ``PillItem`` plus the derived selected flag and the
/// locale-formatted count string (web `({fmtInt(item.count)})`, minus the literal parentheses the view
/// adds). Pre-computing the selected flag + formatted count keeps the SwiftUI body free of derivation.
public struct ResolvedPill: Sendable, Equatable, Identifiable {
    /// The source pill (web `item`).
    public let item: PillItem
    /// Whether this pill is the active one (web `activeKey === item.key`).
    public let isSelected: Bool
    /// The locale-formatted count, bare of parentheses (web `fmtInt(item.count)`); `nil` when no count.
    public let formattedCount: String?

    public var id: String {
        item.key
    }

    public init(item: PillItem, isSelected: Bool, formattedCount: String?) {
        self.item = item
        self.isSelected = isSelected
        self.formattedCount = formattedCount
    }
}

// MARK: - PillFilterBarProjection (view-ready)

/// The resolved, view-ready row — everything the SwiftUI body needs as a pure function of the props (no
/// derivation in the view). `enabledKeys` is the web `items.filter(i => !i.disabled).map(i => i.key)`
/// list that drives arrow navigation; `isEmpty` selects the friendly empty state branch.
public struct PillFilterBarProjection: Sendable, Equatable {
    /// The resolved pills, in source order.
    public let pills: [ResolvedPill]
    /// The non-disabled keys, in source order — the arrow-navigation ring (web `enabledKeys`).
    public let enabledKeys: [String]
    /// No pills are present (native friendly empty-state branch).
    public let isEmpty: Bool
    /// `pills` or `tabs` (web `variant`).
    public let variant: PillVariant
    /// Whether the row scrolls horizontally on overflow (web `scrollable`).
    public let scrollable: Bool
    /// The selected pill key (web `activeKey`).
    public let activeKey: String

    public init(
        pills: [ResolvedPill],
        enabledKeys: [String],
        isEmpty: Bool,
        variant: PillVariant,
        scrollable: Bool,
        activeKey: String
    ) {
        self.pills = pills
        self.enabledKeys = enabledKeys
        self.isEmpty = isEmpty
        self.variant = variant
        self.scrollable = scrollable
        self.activeKey = activeKey
    }
}

// MARK: - PillNavigationDirection (web ArrowLeft / ArrowRight)

/// The arrow-key travel direction — `forward` is the web `ArrowRight` (`delta = 1`), `backward` is the web
/// `ArrowLeft` (`delta = -1`). Both wrap around the `enabledKeys` ring.
public enum PillNavigationDirection: Sendable {
    case forward
    case backward

    /// The web `delta` (`ArrowRight ? 1 : -1`).
    var delta: Int {
        switch self {
        case .forward: 1
        case .backward: -1
        }
    }
}

// MARK: - PillFilterBarProjector (web render body + handleKeyDown)

/// The pure projection from the props to the view-ready model — the surface's data adapter in the
/// "cached → projection" sense the acceptance calls for: it takes the props a page already holds (no
/// fetch, no clock) and derives the rendered row, the enabled-key ring, the locale-formatted counts, and
/// the WAI-ARIA Tabs keyboard math. Unit tested across the selected/disabled/count permutations, the
/// arrow wrap-around (incl. a disabled active key), Home/End, and the count formatting.
public enum PillFilterBarProjector {
    /// Resolves the whole row from the props — the native peer of the web component's render decision.
    public static func resolve(_ input: PillFilterBarInput) -> PillFilterBarProjection {
        let pills = input.items.map { item in
            ResolvedPill(
                item: item,
                isSelected: item.key == input.activeKey,
                formattedCount: item.count.map(formatCount)
            )
        }
        let enabledKeys = input.items.filter { !$0.disabled }.map(\.key)
        return PillFilterBarProjection(
            pills: pills,
            enabledKeys: enabledKeys,
            isEmpty: input.items.isEmpty,
            variant: input.variant,
            scrollable: input.scrollable,
            activeKey: input.activeKey
        )
    }

    // MARK: Count formatting (web `fmtInt`)

    /// The locale-grouped integer string — the native peer of the web `fmtInt(count)` (`fmtNumber(v, 0)`),
    /// which formats with `Intl.NumberFormat` at the global locale (default `en-US`, e.g. `12345 → 12,345`).
    /// A fixed `en_US` formatter keeps the suffix deterministic across host locales, matching the web default.
    public static func formatCount(_ count: Int) -> String {
        countFormatter.string(from: NSNumber(value: count)) ?? String(count)
    }

    private static let countFormatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "en_US")
        formatter.maximumFractionDigits = 0
        formatter.minimumFractionDigits = 0
        return formatter
    }()

    // MARK: Keyboard navigation (web `handleKeyDown`)

    /// The arrow-key target from `currentKey` — the verbatim port of the web `ArrowLeft`/`ArrowRight`
    /// branch: with no enabled keys, or when `currentKey` is not itself enabled, it is a no-op (`nil`);
    /// otherwise it steps one position in `direction` and wraps around the ring
    /// (`(idx + delta + n) % n`).
    public static func nextKey(
        from currentKey: String,
        direction: PillNavigationDirection,
        in enabledKeys: [String]
    ) -> String? {
        guard !enabledKeys.isEmpty else { return nil }
        guard let index = enabledKeys.firstIndex(of: currentKey) else { return nil }
        let count = enabledKeys.count
        let nextIndex = ((index + direction.delta) % count + count) % count
        return enabledKeys[nextIndex]
    }

    /// The Home target — the first enabled key (web `enabledKeys[0]`); `nil` when none are enabled.
    public static func firstKey(in enabledKeys: [String]) -> String? {
        enabledKeys.first
    }

    /// The End target — the last enabled key (web `enabledKeys[enabledKeys.length - 1]`); `nil` when none.
    public static func lastKey(in enabledKeys: [String]) -> String? {
        enabledKeys.last
    }
}
