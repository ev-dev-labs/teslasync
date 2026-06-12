//
//  DataTableColumnMenu.Adapter.swift
//  TeslaSync — P4 shared surface · 0210 · DataTableColumnMenu (Apple)
//
//  The Foundation-only core for the table column visibility + reorder menu — the SwiftUI parity of
//  `components/ui/DataTableColumnMenu.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the caller-facing value types (``ColumnDescriptor`` — web `ColumnDescriptor`,
//  ``ColumnLayout`` — web `ColumnLayout` from `lib/columnOrderStore`), the closure-free per-row render model
//  (``ColumnMenuRow``), the control metrics (``DataTableColumnMenuLayout`` — the native peers of the web
//  Tailwind sizes), and the pure ``ColumnLayoutProjector`` that reproduces `lib/columnOrderStore` plus the
//  component's two mutation handlers (`handleToggle`, `handleMove`) as deterministic functions. No SwiftUI
//  and no `@Observable`, so every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<DataTableColumnMenu>` is a CONTROLLED, storage-agnostic PRESENTATIONAL
//  primitive — its own preamble states "The component is deliberately storage-agnostic — DataTable owns the
//  `localStorage` round-trip and feeds us the current `layout` + a controlled `onChange`." It receives the
//  columns + layout as plain props and renders; there is NO fetch, NO React-Query cache, and NO Promise — so
//  it has NO loading, error, stale, or offline branch (there is nothing to fetch, fail, age, or lose
//  connectivity to). Inventing such chrome would fabricate states the source does not have, so this surface
//  reproduces only the source's REAL branches — exactly as the immediately preceding sibling primitive
//  ContextMenu (0206) did. The real branches are: closed (only the trigger renders), open with one or more
//  column rows (each visible / hidden via its checkbox, reorderable via ↑ / ↓ with disabled ends, with the
//  per-row guardrails), and the empty column set — which the web renders as an empty list and which natively
//  renders a friendly empty body rather than a blank box, per the "never a blank surface" HIG rule. The
//  browser facilities map to native peers: the controlled `layout` + `onChange` → the `@Observable`
//  state-holder owning the layout and notifying a host callback; the click-outside / Escape dismiss → a
//  `.popover` presentation; the `<input type=checkbox>` → a HIG checkbox `Toggle`; the ↑ / ↓ keyboard
//  reorder fallback → labelled step `Button`s driven by the pure projector.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DataTableColumnMenuSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DataTableColumnMenu"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass an identity-fallback resolver.
public typealias DataTableColumnMenuResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - ColumnDescriptor (web `ColumnDescriptor`)

/// One table column's static description — the native peer of the web `ColumnDescriptor`. `key` is the
/// stable identity (web `key`, the React key + layout key); `header` is the display label (web `header`);
/// `isRequired` pins the column visible — its checkbox is disabled (web `required`, e.g. a selection /
/// expand column; reorder is unaffected); `defaultVisible` seeds the "Reset" computation (web
/// `defaultVisible`, defaulting to `true`). A `Sendable`/`Equatable` value type so the view, the
/// state-holder, and the pure projection agree on one shape.
public struct ColumnDescriptor: Sendable, Equatable, Identifiable {
    /// Stable identity (web `key`).
    public let key: String
    /// Display label shown in the row (web `header`).
    public let header: String
    /// When `true` the column cannot be hidden — its checkbox is disabled; reorder still applies (web
    /// `required`).
    public let isRequired: Bool
    /// Default visibility for the "Reset" computation (web `defaultVisible`, defaulting to `true`).
    public let defaultVisible: Bool

    public var id: String {
        key
    }

    public init(key: String, header: String, isRequired: Bool = false, defaultVisible: Bool = true) {
        self.key = key
        self.header = header
        self.isRequired = isRequired
        self.defaultVisible = defaultVisible
    }

    /// The label the row renders — the web `col.header || col.key` (an empty header falls back to the key).
    public var displayLabel: String {
        header.isEmpty ? key : header
    }
}

// MARK: - ColumnLayout (web `ColumnLayout` from lib/columnOrderStore)

/// A table's persisted column layout — the native peer of the web `ColumnLayout`: the column-key `order`
/// (keys not present keep their default position after the present ones, in source order) and the user
/// `hidden` set. `Sendable`/`Equatable` so a host can diff it and persist on change (the web DataTable's
/// `localStorage` round-trip), while this surface stays storage-agnostic.
public struct ColumnLayout: Sendable, Equatable {
    /// Column-key order (web `order`).
    public let order: [String]
    /// Column keys the user has hidden (web `hidden`).
    public let hidden: [String]

    public init(order: [String], hidden: [String]) {
        self.order = order
        self.hidden = hidden
    }

    /// The empty layout (web `EMPTY_LAYOUT`).
    public static let empty = ColumnLayout(order: [], hidden: [])
}

// MARK: - ColumnMenuRow (web per-row render model)

/// One menu row's view-ready description — the native peer of the values the web computes inside its
/// `orderedKeys.map(...)`: the column `key` + `label` (web `col.header || col.key`), whether it is currently
/// `isVisible` (web `checked = !isHidden`), whether its checkbox is `toggleDisabled` (web `checkboxDisabled
/// = col.required || (checked && visibleCount <= 1)` — required columns and the last visible column can't be
/// toggled off), and whether it can move up / down (web `!upDisabled` / `!downDisabled` — the ends of the
/// effective order are pinned). A closure-free `Sendable`/`Equatable` value type so the row view and the
/// projection agree on one shape and the guardrails are testable without SwiftUI.
public struct ColumnMenuRow: Sendable, Equatable, Identifiable {
    /// The column's stable identity (web `col.key`).
    public let key: String
    /// The inline row label (web `col.header || col.key`).
    public let label: String
    /// Whether the column is currently visible (web `checked`).
    public let isVisible: Bool
    /// Whether the visibility checkbox is disabled (web `checkboxDisabled`).
    public let toggleDisabled: Bool
    /// Whether the column can move one slot up (web `!upDisabled`).
    public let canMoveUp: Bool
    /// Whether the column can move one slot down (web `!downDisabled`).
    public let canMoveDown: Bool

    public var id: String {
        key
    }

    public init(
        key: String,
        label: String,
        isVisible: Bool,
        toggleDisabled: Bool,
        canMoveUp: Bool,
        canMoveDown: Bool
    ) {
        self.key = key
        self.label = label
        self.isVisible = isVisible
        self.toggleDisabled = toggleDisabled
        self.canMoveUp = canMoveUp
        self.canMoveDown = canMoveDown
    }
}

// MARK: - DataTableColumnMenuLayout (web Tailwind metrics)

/// The menu's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/DataTableColumnMenu.tsx` (popover `w-72` = 288pt, container `p-2` = 8pt, header `mb-2` =
/// 8pt, list `space-y-0.5` = 2pt / `max-h-72` = 288pt, row `px-2 py-1.5` = 8/6pt with `gap-2` = 8pt, step
/// buttons `h-6 w-6` = 24pt with `gap-0.5` = 2pt and icon `h-3.5 w-3.5` = 14pt, reset icon `h-3 w-3` = 12pt,
/// heading `text-[10px]` = 10pt, trigger `gap-1.5`/`px-2 py-1` = 6/8/4pt). Kept as named constants so the
/// small, surface-specific values are documented rather than scattered magic numbers, mirroring the sibling
/// surfaces' `…Layout` enums.
public enum DataTableColumnMenuLayout {
    /// Popover width (web `w-72`).
    public static let popoverWidth: CGFloat = 288
    /// Inset around the popover content (web `p-2`).
    public static let popoverPadding: CGFloat = 8
    /// Gap below the header row (web `mb-2`).
    public static let headerBottomSpacing: CGFloat = 8
    /// Vertical gap between rows (web `space-y-0.5`).
    public static let rowSpacing: CGFloat = 2
    /// Maximum scrollable list height (web `max-h-72`).
    public static let listMaxHeight: CGFloat = 288
    /// Gap between a row's checkbox, label, and step buttons (web `gap-2`).
    public static let rowContentGap: CGFloat = 8
    /// Horizontal inset inside a row (web `px-2`).
    public static let rowPaddingH: CGFloat = 8
    /// Vertical inset inside a row (web `py-1.5`).
    public static let rowPaddingV: CGFloat = 6
    /// Comfortable minimum row height (HIG tap target; web row is `py-1.5` + `text-sm`).
    public static let rowMinHeight: CGFloat = 32
    /// Step (↑ / ↓) button side (web `h-6 w-6`).
    public static let stepButtonSide: CGFloat = 24
    /// Gap between the two step buttons (web `gap-0.5`).
    public static let stepButtonGap: CGFloat = 2
    /// Step / trigger glyph side (web `h-3.5 w-3.5`).
    public static let iconSide: CGFloat = 14
    /// Reset glyph side (web `h-3 w-3`).
    public static let resetIconSide: CGFloat = 12
    /// Gap inside the default trigger (web `gap-1.5`).
    public static let triggerGap: CGFloat = 6
    /// Horizontal inset of the default trigger (web `px-2`).
    public static let triggerPaddingH: CGFloat = 8
    /// Vertical inset of the default trigger (web `py-1`).
    public static let triggerPaddingV: CGFloat = 4
    /// Heading / reset font size (web `text-[10px]`).
    public static let headingFontSize: CGFloat = 10
    /// The checkbox box side (HIG checkbox glyph; web `<input type=checkbox>`).
    public static let checkboxSide: CGFloat = 18
}

// MARK: - ColumnLayoutProjector (web lib/columnOrderStore + component handlers)

/// The pure projection rules for the menu — the surface's data adapter in the "data → projection" sense the
/// acceptance calls for: it takes the columns + layout a caller already holds (no fetch, no clock) and
/// reproduces `lib/columnOrderStore` (`defaultColumnLayout`, `effectiveColumnOrder`, `applyColumnLayout`,
/// `moveColumn`, `toggleHiddenColumn`) plus the component's two mutation handlers (`handleToggle` with the
/// last-visible guardrail, `handleMove` clamped to the order's bounds) and the per-row render derivation, as
/// deterministic functions. Unit tested across the null-layout / set-layout boundary, the order rules
/// (present-first then source-order append, empty-fallback), the guardrails, and the row projection.
public enum ColumnLayoutProjector {
    // MARK: lib/columnOrderStore ports

    /// The initial layout seeded the first time the menu mutates — the verbatim port of the web
    /// `defaultColumnLayout`: every key in source order, with `defaultVisible: false` columns pre-hidden so
    /// unchanged defaults survive a round-trip.
    public static func defaultLayout(_ columns: [ColumnDescriptor]) -> ColumnLayout {
        ColumnLayout(
            order: columns.map(\.key),
            hidden: columns.filter { !$0.defaultVisible }.map(\.key)
        )
    }

    /// The full ordered key list (visible + hidden) the menu renders rows in — the verbatim port of the web
    /// `effectiveColumnOrder`: present `order` keys first (de-duplicated, dropping unknown keys), then any
    /// remaining source columns appended in source order so a brand-new column shows up at the end. A null /
    /// empty-order layout yields plain source order.
    public static func effectiveOrder(_ columns: [ColumnDescriptor], layout: ColumnLayout?) -> [String] {
        guard let layout, !layout.order.isEmpty else {
            return columns.map(\.key)
        }
        return mergedOrder(columns, order: layout.order)
    }

    /// The ordered VISIBLE columns for rendering the table — the verbatim port of the web
    /// `applyColumnLayout`: a null layout hides `defaultVisible: false` columns in source order; a set
    /// layout drops the hidden keys from the effective order; if that would be empty (a stale layout hid
    /// everything) it falls back to the default-visible set so the table never renders zero columns.
    public static func applyLayout(_ columns: [ColumnDescriptor], layout: ColumnLayout?) -> [ColumnDescriptor] {
        guard let layout else {
            return columns.filter(\.defaultVisible)
        }
        let knownKeys = Set(columns.map(\.key))
        let hiddenSet = Set(layout.hidden.filter { knownKeys.contains($0) })
        let orderedKeys = mergedOrder(columns, order: layout.order)
        let visibleKeys = orderedKeys.filter { !hiddenSet.contains($0) }
        if visibleKeys.isEmpty {
            return columns.filter(\.defaultVisible)
        }
        let byKey = Dictionary(columns.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        return visibleKeys.compactMap { byKey[$0] }
    }

    /// The count of currently-visible columns — the web `visibleCount = applyColumnLayout(columns,
    /// layout).length`, the input to the last-visible guardrail.
    public static func visibleCount(_ columns: [ColumnDescriptor], layout: ColumnLayout?) -> Int {
        applyLayout(columns, layout: layout).count
    }

    /// Moves `key` to `toIndex` within `currentOrder`, returning the new full order — the verbatim port of
    /// the web `moveColumn`: a missing key returns the order unchanged; the target index is clamped into
    /// bounds.
    public static func moveColumn(_ currentOrder: [String], key: String, toIndex: Int) -> [String] {
        guard let fromIndex = currentOrder.firstIndex(of: key) else { return currentOrder }
        var next = currentOrder
        next.remove(at: fromIndex)
        let clamped = max(0, min(toIndex, next.count))
        next.insert(key, at: clamped)
        return next
    }

    /// Toggles a column's hidden state, returning a fresh layout — the verbatim port of the web
    /// `toggleHiddenColumn`: the `order` array is preserved (un-hiding a key restores it in place).
    public static func toggleHidden(_ layout: ColumnLayout, key: String) -> ColumnLayout {
        if layout.hidden.contains(key) {
            return ColumnLayout(order: layout.order, hidden: layout.hidden.filter { $0 != key })
        }
        return ColumnLayout(order: layout.order, hidden: layout.hidden + [key])
    }

    /// The effective hidden-key set driving the checkboxes — the web `new Set((layout ??
    /// defaultColumnLayout(columns)).hidden)`: when the user hasn't touched anything yet it honors
    /// `defaultVisible: false` so the menu reflects the table's initial render.
    public static func effectiveHidden(_ columns: [ColumnDescriptor], layout: ColumnLayout?) -> Set<String> {
        Set((layout ?? defaultLayout(columns)).hidden)
    }

    // MARK: component mutation handlers

    /// The next layout after toggling `key`'s visibility, or `nil` when the toggle is refused — the verbatim
    /// port of the web `handleToggle`: it never hides the last visible column (`if (!isHidden && visibleCount
    /// <= 1) return`). The base is the current layout or the seeded default (web `ensureLayout`).
    public static func toggledLayout(
        _ columns: [ColumnDescriptor],
        layout: ColumnLayout?,
        key: String
    ) -> ColumnLayout? {
        let base = layout ?? defaultLayout(columns)
        let isHidden = base.hidden.contains(key)
        if !isHidden, visibleCount(columns, layout: layout) <= 1 { return nil }
        return toggleHidden(base, key: key)
    }

    /// The next layout after moving `key` by `direction` (`-1` up / `+1` down), or `nil` when the move would
    /// fall off either end — the verbatim port of the web `handleMove`: it computes the from-index in the
    /// effective order, refuses an out-of-range target, then preserves the hidden set while reordering.
    public static func movedLayout(
        _ columns: [ColumnDescriptor],
        layout: ColumnLayout?,
        key: String,
        direction: Int
    ) -> ColumnLayout? {
        let base = layout ?? defaultLayout(columns)
        let currentOrder = effectiveOrder(columns, layout: base)
        guard let fromIndex = currentOrder.firstIndex(of: key) else { return nil }
        let toIndex = fromIndex + direction
        if toIndex < 0 || toIndex >= currentOrder.count { return nil }
        let nextOrder = moveColumn(currentOrder, key: key, toIndex: toIndex)
        return ColumnLayout(order: nextOrder, hidden: base.hidden)
    }

    // MARK: row projection (web `orderedKeys.map(...)`)

    /// The per-row render models in effective order — the verbatim port of the web `orderedKeys.map(...)`:
    /// each known column becomes a ``ColumnMenuRow`` carrying its label (web `col.header || col.key`),
    /// visibility (web `checked`), the checkbox-disabled guardrail (web `checkboxDisabled`), and the
    /// pinned-end move flags (web `!upDisabled` / `!downDisabled`). Unknown keys are skipped (web
    /// `if (!col) return null`).
    public static func rows(_ columns: [ColumnDescriptor], layout: ColumnLayout?) -> [ColumnMenuRow] {
        let orderedKeys = effectiveOrder(columns, layout: layout)
        let byKey = Dictionary(columns.map { ($0.key, $0) }, uniquingKeysWith: { first, _ in first })
        let hidden = effectiveHidden(columns, layout: layout)
        let count = visibleCount(columns, layout: layout)
        let lastIndex = orderedKeys.count - 1
        return orderedKeys.enumerated().compactMap { index, key in
            guard let col = byKey[key] else { return nil }
            let isVisible = !hidden.contains(key)
            let toggleDisabled = col.isRequired || (isVisible && count <= 1)
            return ColumnMenuRow(
                key: key,
                label: col.displayLabel,
                isVisible: isVisible,
                toggleDisabled: toggleDisabled,
                canMoveUp: index != 0,
                canMoveDown: index != lastIndex
            )
        }
    }

    // MARK: shared order merge (web order rules used by effectiveOrder + applyColumnLayout)

    /// The "present `order` keys first, then remaining source columns in source order" merge shared by the
    /// web `effectiveColumnOrder` and `applyColumnLayout`. De-duplicates and drops keys no longer present in
    /// `columns`.
    private static func mergedOrder(_ columns: [ColumnDescriptor], order: [String]) -> [String] {
        let knownKeys = Set(columns.map(\.key))
        var ordered: [String] = []
        var seen = Set<String>()
        for key in order where knownKeys.contains(key) && !seen.contains(key) {
            ordered.append(key)
            seen.insert(key)
        }
        for col in columns where !seen.contains(col.key) {
            ordered.append(col.key)
            seen.insert(col.key)
        }
        return ordered
    }
}
