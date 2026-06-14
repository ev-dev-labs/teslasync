//
//  DataTable.SelectionProjector.swift
//  TeslaSync — P4 shared surface · 0208 · DataTable (Apple)
//
//  The Foundation-only selection arithmetic for the data table — the verbatim port of the web component's
//  `toggleRow` / `toggleAll` handlers and the `allSelected` / `someSelected` header predicates. The web keeps
//  selection as a controlled `RowKey[]` whose membership is tested through a `Set`; the native peer works on a
//  `Set<DataTableRowKey>` (clean value semantics; render only cares about membership, so the array order the
//  web preserves is immaterial). Pure functions, no SwiftUI, no state — the row anchor for shift-range lives in
//  the state-holder and is passed in. Unit-tested across single / multi / shift-range / select-all.
//

import Foundation

// MARK: - DataTableSelectionProjector (web `toggleRow` / `toggleAll`)

/// The selection rules — the surface's selection adapter. Each function takes the current selection (and, for
/// the header predicates / range / select-all, the ordered visible keys) and returns the next selection, so
/// the state-holder simply stores the result and notifies the host (web `onSelectionChange`).
public enum DataTableSelectionProjector {
    /// Whether every row is selected — the verbatim web `allSelected = allRowKeys.length > 0 &&
    /// allRowKeys.every(k => selectionSet.has(k))`.
    public static func allSelected(allKeys: [DataTableRowKey], selection: Set<DataTableRowKey>) -> Bool {
        guard !allKeys.isEmpty else { return false }
        return allKeys.allSatisfy { selection.contains($0) }
    }

    /// Whether some-but-not-all rows are selected (the header checkbox's indeterminate state) — the verbatim
    /// web `someSelected = allRowKeys.some(k => selectionSet.has(k)) && !allSelected`.
    public static func someSelected(allKeys: [DataTableRowKey], selection: Set<DataTableRowKey>) -> Bool {
        let any = allKeys.contains { selection.contains($0) }
        return any && !allSelected(allKeys: allKeys, selection: selection)
    }

    /// Single-select toggle — the verbatim web `selectable === 'single'` branch: deselect when already the sole
    /// pick, otherwise replace the selection with just this row.
    public static func toggleSingle(
        selection: Set<DataTableRowKey>,
        key: DataTableRowKey
    ) -> Set<DataTableRowKey> {
        selection.contains(key) ? [] : [key]
    }

    /// Multi-select membership toggle (no shift) — the verbatim web fallback: add the key when absent, remove it
    /// when present.
    public static func toggleMembership(
        selection: Set<DataTableRowKey>,
        key: DataTableRowKey
    ) -> Set<DataTableRowKey> {
        var next = selection
        if next.contains(key) {
            next.remove(key)
        } else {
            next.insert(key)
        }
        return next
    }

    /// Additive shift-range — the verbatim web multi `shift && lastClicked` branch: the inclusive range between
    /// the anchor and the target (in visible order) is UNIONED into the selection (additive, never replacing).
    /// When either endpoint is missing from `allKeys` the web falls back to a plain membership toggle of the
    /// target, mirrored here.
    public static func selectRange(
        allKeys: [DataTableRowKey],
        selection: Set<DataTableRowKey>,
        anchor: DataTableRowKey,
        target: DataTableRowKey
    ) -> Set<DataTableRowKey> {
        guard
            let fromIndex = allKeys.firstIndex(of: anchor),
            let toIndex = allKeys.firstIndex(of: target)
        else {
            return toggleMembership(selection: selection, key: target)
        }
        let bounds = fromIndex <= toIndex ? (fromIndex, toIndex) : (toIndex, fromIndex)
        var next = selection
        for key in allKeys[bounds.0 ... bounds.1] {
            next.insert(key)
        }
        return next
    }

    /// Select-all / clear-all toggle — the verbatim web `toggleAll`: clear when everything is already selected,
    /// otherwise select every visible row.
    public static func toggleAll(
        allKeys: [DataTableRowKey],
        selection: Set<DataTableRowKey>
    ) -> Set<DataTableRowKey> {
        allSelected(allKeys: allKeys, selection: selection) ? [] : Set(allKeys)
    }

    /// Expansion membership toggle — the verbatim web `toggleExpand`: add the key when collapsed, remove it when
    /// expanded. Shares the membership shape with selection but is kept named for call-site clarity.
    public static func toggleExpansion(
        expansion: Set<DataTableRowKey>,
        key: DataTableRowKey
    ) -> Set<DataTableRowKey> {
        toggleMembership(selection: expansion, key: key)
    }
}
