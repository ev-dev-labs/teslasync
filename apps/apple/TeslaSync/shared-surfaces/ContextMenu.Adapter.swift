//
//  ContextMenu.Adapter.swift
//  TeslaSync — P4 shared surface · 0206 · ContextMenu (Apple)
//
//  The Foundation/CoreGraphics-only core for the app-global contextual action menu — the SwiftUI parity of
//  `components/ui/ContextMenu.tsx`. This file owns the surface identity (the diagnostics slug), the i18n
//  facade seam, the closure-free item descriptor (``ContextMenuItemDescriptor`` — web `ContextMenuItem`
//  minus its `onClick`/`icon` node), the control metrics (``ContextMenuLayout`` — the native peers of the
//  web Tailwind sizes), and the pure ``ContextMenuProjector`` that reproduces the source's three
//  browser-driven derivations as deterministic functions: the empty-open guard (web `openContextMenu`
//  returns early on an empty item list), the enabled-item keyboard traversal (web `enabledIndices` /
//  `focusNextEnabled` with wrap-around, skipping disabled rows), and the measure-and-flip placement (web
//  `useLayoutEffect`: flip the anchor edge when the menu would overflow the viewport, clamped to a margin).
//  No SwiftUI and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<ContextMenu>` is an IMPERATIVE UI primitive — an app-global pub/sub
//  store (`useSyncExternalStore`) feeding a portal-rendered menu host. It takes its items as plain data
//  (resolved by the caller at right-click time) and renders; there is no fetch, no React-Query cache, and
//  no Promise — so it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail,
//  age, or lose connectivity to). Inventing such chrome would fabricate states the source does not have, so
//  this surface reproduces only the source's REAL branches — exactly as the sibling presentational /
//  imperative primitives StickyChipBar (0200), ActiveFilterChips (0147), and SortControl (0159) did. The
//  real branches are: closed (no menu), open with one or more rows (each row enabled / disabled / tinted
//  destructive, with an optional leading icon and a trailing shortcut), and the empty item set — which the
//  web silently refuses to open and which natively renders a friendly empty body rather than a blank box,
//  per the "never a blank surface" HIG rule. The browser-only facilities map to native peers: the viewport
//  measure-and-flip → ``ContextMenuProjector/place(anchor:menuSize:containerSize:margin:)`` fed the host's
//  geometry; the document focus-restore → SwiftUI focus management; right-click → a long-press / secondary
//  -click trigger.
//

import CoreGraphics
import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum ContextMenuSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "ContextMenu"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass an identity-fallback resolver.
public typealias ContextMenuResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - ContextMenuItemDescriptor (web `ContextMenuItem`, closure-free)

/// One menu row's view-ready, closure-free description — the native peer of the web `ContextMenuItem`,
/// minus its `onClick` handler (carried by ``ContextMenuAction`` in the model layer) and its arbitrary
/// `icon` React node (narrowed to an SF Symbol name, the HIG-idiomatic menu glyph). `id` is the stable
/// identity (web `item.id`, the React key); `label` is the inline row text (web `item.label`);
/// `systemImage` is the optional leading glyph (web `item.icon`); `isDisabled` renders the row visibly but
/// non-interactive (web `item.disabled`); `isDestructive` tints the row with the danger color (web
/// `item.destructive`); `shortcut` is the optional right-aligned hint (web `item.shortcut`). A
/// `Sendable`/`Equatable` value type so the view, the state-holder, and the pure projection agree on one
/// shape and so the keyboard-traversal + placement rules are testable without the live handler closures.
public struct ContextMenuItemDescriptor: Sendable, Equatable, Identifiable {
    /// Stable identity (web `item.id`, used as the React key / VoiceOver identifier).
    public let id: String
    /// Inline row text (web `item.label`).
    public let label: String
    /// Optional leading SF Symbol glyph (web `item.icon`).
    public let systemImage: String?
    /// Rendered visibly but non-interactive (web `item.disabled`).
    public let isDisabled: Bool
    /// Tinted with the danger color, e.g. Delete / Archive (web `item.destructive`).
    public let isDestructive: Bool
    /// Optional right-aligned shortcut hint, e.g. "⌘⇧D" (web `item.shortcut`).
    public let shortcut: String?

    public init(
        id: String,
        label: String,
        systemImage: String? = nil,
        isDisabled: Bool = false,
        isDestructive: Bool = false,
        shortcut: String? = nil
    ) {
        self.id = id
        self.label = label
        self.systemImage = systemImage
        self.isDisabled = isDisabled
        self.isDestructive = isDestructive
        self.shortcut = shortcut
    }
}

// MARK: - ContextMenuLayout (web Tailwind metrics)

/// The menu's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/ContextMenu.tsx` (`min-w-[12rem]` = 192pt, `max-w-[20rem]` = 320pt, container `p-1` = 4pt,
/// `space-y-0.5` = 2pt between rows, row `px-2 py-1.5` = 8/6pt, `gap-2` = 8pt, icon `h-4 w-4` = 16pt,
/// shortcut `text-[10px]` = 10pt, and `VIEWPORT_MARGIN` = 8pt). Kept as named constants so the small,
/// surface-specific values are documented rather than scattered magic numbers, mirroring the sibling
/// surfaces' `…Layout` enums.
public enum ContextMenuLayout {
    /// Minimum menu width (web `min-w-[12rem]`).
    public static let minWidth: CGFloat = 192
    /// Maximum menu width (web `max-w-[20rem]`).
    public static let maxWidth: CGFloat = 320
    /// Inset around the row stack (web container `p-1`).
    public static let containerPadding: CGFloat = 4
    /// Vertical gap between rows (web `space-y-0.5`).
    public static let rowSpacing: CGFloat = 2
    /// Horizontal inset inside a row (web `px-2`).
    public static let rowPaddingH: CGFloat = 8
    /// Vertical inset inside a row (web `py-1.5`).
    public static let rowPaddingV: CGFloat = 6
    /// Gap between the icon, label, and shortcut (web `gap-2`).
    public static let rowContentGap: CGFloat = 8
    /// Leading glyph box side (web `h-4 w-4`).
    public static let iconSide: CGFloat = 16
    /// Shortcut hint font size (web `text-[10px]`).
    public static let shortcutFontSize: CGFloat = 10
    /// Comfortable minimum row height (HIG menu-row tap target; web row is `py-1.5` + `text-sm`).
    public static let rowMinHeight: CGFloat = 32
    /// Distance the menu keeps from the container edge before flipping (web `VIEWPORT_MARGIN`).
    public static let viewportMargin: CGFloat = 8
}

// MARK: - ContextMenuProjector (web render-body + flip + keyboard rules)

/// The pure projection rules for the menu — the surface's data adapter in the "data → projection" sense the
/// acceptance calls for: it takes the items a caller already holds (no fetch, no clock) plus the host's
/// geometry, and reproduces the source's three browser-driven derivations as deterministic functions: the
/// empty-open guard, the enabled-row keyboard traversal, and the measure-and-flip placement. Unit tested
/// across the empty / populated boundary, the disabled-skip + wrap-around traversal, and every flip case.
public enum ContextMenuProjector {
    /// Whether a right-click should open the menu at all — the verbatim port of the web guard
    /// `if (!items || items.length === 0) return;`. An all-disabled list still opens (the rows render
    /// visibly non-interactive, web parity); only an empty list is refused.
    public static func shouldOpen(_ items: [ContextMenuItemDescriptor]) -> Bool {
        !items.isEmpty
    }

    /// The indices of the interactive rows — the verbatim port of the web `enabledIndices` (every row whose
    /// `disabled` is falsey). Disabled rows are skipped by keyboard traversal but still rendered.
    public static func enabledIndices(_ items: [ContextMenuItemDescriptor]) -> [Int] {
        items.enumerated().compactMap { index, item in item.isDisabled ? nil : index }
    }

    /// The first interactive row index (web `focusFirstEnabled`), or `nil` when every row is disabled.
    public static func firstEnabledIndex(_ items: [ContextMenuItemDescriptor]) -> Int? {
        enabledIndices(items).first
    }

    /// The last interactive row index (web `focusLastEnabled`), or `nil` when every row is disabled.
    public static func lastEnabledIndex(_ items: [ContextMenuItemDescriptor]) -> Int? {
        enabledIndices(items).last
    }

    /// The next interactive row in the given direction — the verbatim port of the web `focusNextEnabled`:
    /// `+1` moves down, `-1` moves up, both wrap around the enabled set. When focus is not currently on an
    /// enabled row (web cursor `=== -1`, e.g. the menu container holds focus) it lands on the first enabled
    /// row going down or the last going up. Returns `nil` only when no row is enabled.
    public static func nextEnabledIndex(
        after current: Int?,
        in items: [ContextMenuItemDescriptor],
        step: Int
    ) -> Int? {
        let enabled = enabledIndices(items)
        guard !enabled.isEmpty else { return nil }
        let direction = step >= 0 ? 1 : -1
        guard let current, let cursor = enabled.firstIndex(of: current) else {
            return direction == 1 ? enabled.first : enabled.last
        }
        let nextCursor = (cursor + direction + enabled.count) % enabled.count
        return enabled[nextCursor]
    }

    /// The menu's top-leading origin in the host's coordinate space — the verbatim port of the web
    /// measure-and-flip pass (`useLayoutEffect`). The menu opens at `anchor`; if its right edge would cross
    /// `containerSize.width - margin` it flips to open leftward (`anchor.x - menuSize.width`, clamped to the
    /// margin), and likewise the bottom edge flips upward. Either edge flips independently, exactly as the
    /// source corrects `left` then `top`.
    public static func place(
        anchor: CGPoint,
        menuSize: CGSize,
        containerSize: CGSize,
        margin: CGFloat = ContextMenuLayout.viewportMargin
    ) -> CGPoint {
        var originX = anchor.x
        var originY = anchor.y
        if originX + menuSize.width + margin > containerSize.width {
            originX = max(margin, anchor.x - menuSize.width)
        }
        if originY + menuSize.height + margin > containerSize.height {
            originY = max(margin, anchor.y - menuSize.height)
        }
        return CGPoint(x: originX, y: originY)
    }
}
