//
//  DataTableColumnsMenu.Adapter.swift
//  TeslaSync — P4 shared surface · 0211 · DataTableColumnsMenu (Apple)
//
//  The Foundation-only core for the table column-visibility menu — the SwiftUI parity of
//  `components/ui/DataTableColumnsMenu.tsx`. This file owns the surface identity (the diagnostics slug), the
//  i18n facade seam, the caller-facing value type (``DataTableColumnsMenuColumn`` — the web
//  `ColumnDescriptor`), the closure-free per-row render model (``DataTableColumnsMenuRow``), the control
//  metrics (``DataTableColumnsMenuLayout`` — the native peers of the web Tailwind sizes), and the pure
//  ``DataTableColumnsMenuProjector`` that reproduces the component's two mutation handlers (its `toggle` and
//  `showAll`) plus the per-row derivation as deterministic functions. No SwiftUI and no `@Observable`, so
//  every rule is unit-testable in isolation.
//
//  Faithful-parity note: the web `<DataTableColumnsMenu>` is a CONTROLLED, storage-agnostic PRESENTATIONAL
//  primitive — its own doc comment states "Persists nothing on its own — DataTable owns persistence via
//  tableId." It receives `columns` + `visibleKeys` as plain props and renders an icon-button trigger plus a
//  click-dismissed popover; there is NO fetch, NO React-Query cache, and NO Promise — so it has NO loading,
//  error, stale, or offline branch (there is nothing to fetch, fail, age, or lose connectivity to). Inventing
//  such chrome would fabricate states the source does not have, so this surface reproduces only the source's
//  REAL branches — exactly as the sibling primitive DataTableColumnMenu (0210) did. The real branches are:
//  closed (only the trigger renders), open with one or more column rows (each shown / hidden via its
//  checkbox, with the per-row guardrails — a required column is pinned visible, the last visible column can't
//  be hidden) plus the "Show all" control, and the empty column set — which the web renders as an empty list
//  and which natively renders a friendly empty body rather than a blank box, per the "never a blank surface"
//  HIG rule. The browser facilities map to native peers: the controlled `visibleKeys` + `onChange` → the
//  `@Observable` state-holder owning the keys and notifying a host callback; the click-outside / Escape
//  dismiss → a `.popover` presentation; the `<input type=checkbox>` → a HIG checkbox `Toggle`.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum DataTableColumnsMenuSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "DataTableColumnsMenu"
}

// MARK: - Localization facade seam (web `t(key, default)` → P1/S10 key)

/// A `(key, fallback) -> String` resolver — the native shape of the web `t(key, default)`. Kept as a plain
/// closure so the pure core has no dependency on a bundle: the production app passes the P1/S10 facade,
/// while tests pass an identity-fallback resolver.
public typealias DataTableColumnsMenuResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - DataTableColumnsMenuColumn (web `ColumnDescriptor`)

/// One table column's static description — the native peer of the web `ColumnDescriptor`. `key` is the
/// stable identity (web `key`, the React key + visibility key); `header` is the display label (web `header`);
/// `isRequired` pins the column visible — its checkbox is disabled (web `required`, e.g. a selection /
/// expand column). A `Sendable`/`Equatable` value type so the view, the state-holder, and the pure
/// projection agree on one shape.
public struct DataTableColumnsMenuColumn: Sendable, Equatable, Identifiable {
    /// Stable identity (web `key`).
    public let key: String
    /// Display label shown in the row (web `header`).
    public let header: String
    /// When `true` the column cannot be hidden — its checkbox is disabled (web `required`).
    public let isRequired: Bool

    public var id: String {
        key
    }

    public init(key: String, header: String, isRequired: Bool = false) {
        self.key = key
        self.header = header
        self.isRequired = isRequired
    }

    /// The label the row renders — the web `col.header || col.key` (an empty header falls back to the key).
    public var displayLabel: String {
        header.isEmpty ? key : header
    }
}

// MARK: - DataTableColumnsMenuRow (web per-row render model)

/// One menu row's view-ready description — the native peer of the values the web computes inside its
/// `columns.map(...)`: the column `key` + `label` (web `col.header || col.key`), whether it is currently
/// `isVisible` (web `checked = visibleSet.has(col.key)`), and whether its checkbox is `toggleDisabled` (web
/// `disabled = col.required || (checked && visibleKeys.length <= 1)` — required columns and the last visible
/// column can't be toggled off). A closure-free `Sendable`/`Equatable` value type so the row view and the
/// projection agree on one shape and the guardrails are testable without SwiftUI.
public struct DataTableColumnsMenuRow: Sendable, Equatable, Identifiable {
    /// The column's stable identity (web `col.key`).
    public let key: String
    /// The inline row label (web `col.header || col.key`).
    public let label: String
    /// Whether the column is currently visible (web `checked`).
    public let isVisible: Bool
    /// Whether the visibility checkbox is disabled (web `disabled`).
    public let toggleDisabled: Bool

    public var id: String {
        key
    }

    public init(key: String, label: String, isVisible: Bool, toggleDisabled: Bool) {
        self.key = key
        self.label = label
        self.isVisible = isVisible
        self.toggleDisabled = toggleDisabled
    }
}

// MARK: - DataTableColumnsMenuLayout (web Tailwind metrics)

/// The menu's precise metrics — the native peers of the web Tailwind utilities on
/// `components/ui/DataTableColumnsMenu.tsx` (popover `w-56` = 224pt, container `p-2` = 8pt, header `mb-2` =
/// 8pt, list `space-y-0.5` = 2pt / `max-h-64` = 256pt, row `px-2 py-1.5` = 8/6pt with `gap-2` = 8pt, trigger
/// `gap-1.5`/`px-2 py-1` = 6/8/4pt, trigger glyph `h-3.5 w-3.5` = 14pt, heading / "Show all" `text-[10px]` =
/// 10pt). Kept as named constants so the small, surface-specific values are documented rather than scattered
/// magic numbers, mirroring the sibling surfaces' `…Layout` enums.
public enum DataTableColumnsMenuLayout {
    /// Popover width (web `w-56`).
    public static let popoverWidth: CGFloat = 224
    /// Inset around the popover content (web `p-2`).
    public static let popoverPadding: CGFloat = 8
    /// Gap below the header row (web `mb-2`).
    public static let headerBottomSpacing: CGFloat = 8
    /// Vertical gap between rows (web `space-y-0.5`).
    public static let rowSpacing: CGFloat = 2
    /// Maximum scrollable list height (web `max-h-64`).
    public static let listMaxHeight: CGFloat = 256
    /// Gap between a row's checkbox and label (web `gap-2`).
    public static let rowContentGap: CGFloat = 8
    /// Horizontal inset inside a row (web `px-2`).
    public static let rowPaddingH: CGFloat = 8
    /// Vertical inset inside a row (web `py-1.5`).
    public static let rowPaddingV: CGFloat = 6
    /// Comfortable minimum row height (HIG tap target; web row is `py-1.5` + `text-sm`).
    public static let rowMinHeight: CGFloat = 32
    /// Trigger glyph side (web `h-3.5 w-3.5`).
    public static let iconSide: CGFloat = 14
    /// Gap inside the default trigger (web `gap-1.5`).
    public static let triggerGap: CGFloat = 6
    /// Horizontal inset of the default trigger (web `px-2`).
    public static let triggerPaddingH: CGFloat = 8
    /// Vertical inset of the default trigger (web `py-1`).
    public static let triggerPaddingV: CGFloat = 4
    /// Heading / "Show all" font size (web `text-[10px]`).
    public static let headingFontSize: CGFloat = 10
    /// The checkbox box side (HIG checkbox glyph; web `<input type=checkbox>`).
    public static let checkboxSide: CGFloat = 18
}

// MARK: - DataTableColumnsMenuProjector (web component handlers + row derivation)

/// The pure projection rules for the menu — the surface's data adapter in the "data → projection" sense the
/// acceptance calls for: it takes the `columns` + `visibleKeys` a caller already holds (no fetch, no clock)
/// and reproduces the component's two mutation handlers (`toggle` with the last-visible guardrail, `showAll`)
/// and the per-row render derivation as deterministic functions. Unit tested across the show / hide
/// branches, the last-visible guardrail, the required-column pin, the source-order preservation on show, and
/// the empty set.
public enum DataTableColumnsMenuProjector {
    // MARK: row projection (web `columns.map(...)`)

    /// The per-row render models in source order — the verbatim port of the web `columns.map((col) => …)`:
    /// each column becomes a ``DataTableColumnsMenuRow`` carrying its label (web `col.header || col.key`),
    /// visibility (web `checked = visibleSet.has(col.key)`), and the checkbox-disabled guardrail (web
    /// `disabled = col.required || (checked && visibleKeys.length <= 1)` — a required column and the last
    /// visible column can't be toggled off).
    public static func rows(
        _ columns: [DataTableColumnsMenuColumn],
        visibleKeys: [String]
    ) -> [DataTableColumnsMenuRow] {
        let visibleSet = Set(visibleKeys)
        let isLastVisible = visibleKeys.count <= 1
        return columns.map { col in
            let isVisible = visibleSet.contains(col.key)
            return DataTableColumnsMenuRow(
                key: col.key,
                label: col.displayLabel,
                isVisible: isVisible,
                toggleDisabled: col.isRequired || (isVisible && isLastVisible)
            )
        }
    }

    /// The ordered VISIBLE columns — the columns whose key is in `visibleKeys`, kept in source order so a
    /// host can mirror the menu's selection onto a live table.
    public static func visibleColumns(
        _ columns: [DataTableColumnsMenuColumn],
        visibleKeys: [String]
    ) -> [DataTableColumnsMenuColumn] {
        let visibleSet = Set(visibleKeys)
        return columns.filter { visibleSet.contains($0.key) }
    }

    // MARK: component mutation handlers

    /// The next `visibleKeys` after toggling `key`, or `nil` when the toggle is refused — the verbatim port
    /// of the web `toggle`:
    ///   • when the key is currently visible it is HIDDEN, unless it is the last visible column
    ///     (`if (visibleKeys.length <= 1) return`), in which case the toggle is a no-op (returns `nil`);
    ///   • when the key is currently hidden it is SHOWN, and the resulting list is rebuilt in the original
    ///     column order (web `order.filter((k) => visibleSet.has(k) || k === key)`) so the persisted
    ///     selection always follows source order.
    public static func toggledKeys(
        _ columns: [DataTableColumnsMenuColumn],
        visibleKeys: [String],
        key: String
    ) -> [String]? {
        let visibleSet = Set(visibleKeys)
        if visibleSet.contains(key) {
            if visibleKeys.count <= 1 { return nil }
            return visibleKeys.filter { $0 != key }
        }
        let order = columns.map(\.key)
        return order.filter { visibleSet.contains($0) || $0 == key }
    }

    /// Every column key in source order — the verbatim port of the web `showAll = () =>
    /// onChange(columns.map((c) => c.key))`.
    public static func allKeys(_ columns: [DataTableColumnsMenuColumn]) -> [String] {
        columns.map(\.key)
    }
}
