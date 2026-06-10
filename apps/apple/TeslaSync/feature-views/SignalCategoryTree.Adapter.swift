//
//  SignalCategoryTree.Adapter.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  Pure, Foundation-only ports of the web SignalCategoryTree + TreeSelect display
//  logic so the executed host harness and the XCTest suite can prove parity
//  without rendering a view:
//    • `SignalCategoryCatalog` — the closed CATEGORY_LABELS map + CATEGORY_ORDER
//      ranking and `friendlyCategoryLabel` (web module constants).
//    • `SignalCategoryTreeBuilder.buildProjection` — group by category, sort
//      leaves by name, order groups by rank then label (web `groups` useMemo).
//    • `SignalCategoryTreeBuilder.filter` — the search filter (web `filterGroups`:
//      a group-label match keeps all leaves, otherwise only matching leaves; empty
//      groups drop).
//    • tri-state + count helpers and the selection transforms (web `toggleLeaf` /
//      `toggleGroup` / `toggleAllVisible`, the `selectAll` label, and the
//      `{selected}/{total}` counts).
//

import Foundation

// MARK: - Category catalog (web module constants)

/// The closed set of routing categories shipped by `internal/tesla/protomodel`,
/// their friendly labels, and the stable display order — the Swift port of the
/// web `CATEGORY_LABELS` / `CATEGORY_ORDER` / `categoryRank` / `friendlyCategoryLabel`.
public enum SignalCategoryCatalog {
    /// Friendly label per category id. Unknown ids fall back to the raw id.
    public static let labels: [String: String] = [
        "charging": "Charging",
        "driving": "Driving",
        "climate": "Climate",
        "location": "Location",
        "powertrain": "Powertrain",
        "vehicle_state": "Vehicle State",
        "safety_security": "Safety & Security",
        "media": "Media",
        "config": "Config",
        "prefs": "Preferences",
        "setting_unit": "Setting Units",
        "metadata": "Metadata"
    ]

    /// Stable display order. Unknown categories sort last, then alphabetically.
    public static let order: [String] = [
        "charging",
        "driving",
        "powertrain",
        "climate",
        "location",
        "vehicle_state",
        "safety_security",
        "media",
        "config",
        "prefs",
        "setting_unit",
        "metadata"
    ]

    /// The sort rank of a category (web `categoryRank`): its index in `order`, or
    /// `order.count` (sorts last) when it is not a known category.
    public static func rank(_ id: String) -> Int {
        order.firstIndex(of: id) ?? order.count
    }

    /// The localization key suffix for a known category's friendly label, so the
    /// label resolves through the P1/S10 facade. Unknown ids return `nil` (the raw
    /// category id is shown verbatim, matching the web `?? id` fallback).
    public static func labelKey(_ id: String) -> String? {
        labels[id] == nil ? nil : "telemetry.signalTree.category.\(id)"
    }
}

// MARK: - Projection + filter (web `groups` / `filterGroups`)

/// Pure builders that turn the available-signal catalog into ordered category
/// groups and apply the live search filter. Mirrors the web `groups` useMemo and
/// the TreeSelect `filterGroups` helper.
public enum SignalCategoryTreeBuilder {
    /// Groups descriptors by `category`, sorts each group's leaves by name, and
    /// orders the groups by category rank then friendly label — the Swift port of
    /// the web `groups` useMemo. `label` resolves through `localize` so the
    /// friendly category labels come from the P1/S10 catalog (the raw id is used
    /// for unknown categories, matching the web `?? id`).
    public static func buildProjection(
        from descriptors: [SignalDescriptor],
        localize: (String) -> String = friendlyLabel
    ) -> SignalCategoryTreeProjection {
        guard !descriptors.isEmpty else { return .empty }

        var byCategory: [String: [SignalDescriptor]] = [:]
        for descriptor in descriptors {
            byCategory[descriptor.category, default: []].append(descriptor)
        }

        var groups: [SignalCategoryGroup] = []
        for (category, list) in byCategory {
            let leaves = list
                .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
                .map(SignalCategoryLeaf.init(descriptor:))
            groups.append(
                SignalCategoryGroup(id: category, label: localize(category), leaves: leaves)
            )
        }

        groups.sort { lhs, rhs in
            let lrank = SignalCategoryCatalog.rank(lhs.id)
            let rrank = SignalCategoryCatalog.rank(rhs.id)
            if lrank != rrank { return lrank < rrank }
            return lhs.label.localizedStandardCompare(rhs.label) == .orderedAscending
        }

        return SignalCategoryTreeProjection(groups: groups)
    }

    /// The default friendly-label resolver used when no localization closure is
    /// supplied (host harness / tests): the in-source English `CATEGORY_LABELS`,
    /// falling back to the raw id (web `friendlyCategoryLabel`).
    public static func friendlyLabel(_ category: String) -> String {
        SignalCategoryCatalog.labels[category] ?? category
    }

    /// Filters groups by a search needle — the Swift port of the web `filterGroups`:
    /// a case-insensitive match on the group label keeps all of that group's
    /// leaves; otherwise only leaves whose label matches are kept; groups with no
    /// surviving leaves are dropped. A blank needle returns the input unchanged.
    public static func filter(_ groups: [SignalCategoryGroup], query: String) -> [SignalCategoryGroup] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return groups }

        var out: [SignalCategoryGroup] = []
        for group in groups {
            let groupMatches = group.label.lowercased().contains(needle)
            let leaves = groupMatches
                ? group.leaves
                : group.leaves.filter { $0.label.lowercased().contains(needle) }
            guard !leaves.isEmpty else { continue }
            out.append(SignalCategoryGroup(id: group.id, label: group.label, leaves: leaves))
        }
        return out
    }
}

// MARK: - Tri-state + counts + selection transforms (web TreeSelect)

/// The pure selection arithmetic the TreeSelect header / group rows render and the
/// selection transforms toggling produces. Selection is a `Set<String>` of leaf
/// ids; transforms preserve selections outside the visible (filtered) set exactly
/// like the web `toggleGroup` / `toggleAllVisible`.
public enum SignalCategorySelection {
    /// The tri-state of a checkbox covering `leafIDs` against `selected` (web
    /// `allSelected` / `someSelected`): `.all` when every id is selected, `.none`
    /// when zero are, `.partial` otherwise. An empty id list is `.none`.
    public static func state(of leafIDs: [String], in selected: Set<String>) -> SignalSelectionState {
        guard !leafIDs.isEmpty else { return .none }
        var selectedCount = 0
        for id in leafIDs where selected.contains(id) {
            selectedCount += 1
        }
        if selectedCount == 0 { return .none }
        return selectedCount == leafIDs.count ? .all : .partial
    }

    /// How many of `leafIDs` are selected (web `groupSelectedCount` /
    /// `visibleSelectedCount` reduce).
    public static func selectedCount(of leafIDs: [String], in selected: Set<String>) -> Int {
        leafIDs.reduce(0) { selected.contains($1) ? $0 + 1 : $0 }
    }

    /// Toggles a single leaf in/out of the selection (web `toggleLeaf`).
    public static func toggleLeaf(_ leafID: String, in selected: Set<String>) -> Set<String> {
        var next = selected
        if next.contains(leafID) {
            next.remove(leafID)
        } else {
            next.insert(leafID)
        }
        return next
    }

    /// Toggles a set of (visible) leaf ids as a unit (web `toggleGroup` /
    /// `toggleAllVisible`): if all are already selected, remove them all;
    /// otherwise add them all. Selections outside `leafIDs` are preserved. An
    /// empty id list is a no-op.
    public static func toggleAll(_ leafIDs: [String], in selected: Set<String>) -> Set<String> {
        guard !leafIDs.isEmpty else { return selected }
        var next = selected
        if leafIDs.allSatisfy(next.contains) {
            for id in leafIDs {
                next.remove(id)
            }
        } else {
            for id in leafIDs {
                next.insert(id)
            }
        }
        return next
    }
}

// MARK: - Select-all label (web `selectAllLabel`)

/// The four shapes the top select-all control takes (web `selectAllLabel`),
/// resolved to a localized string by the P1/S10 facade. `visible` carries the
/// count for the searching variants.
public enum SignalCategorySelectAllLabel: Equatable, Sendable {
    case selectAll
    case clearAll
    case selectVisible(Int)
    case clearVisible(Int)

    /// Web `selectAllLabel`: while searching the action is scoped to the visible
    /// count; otherwise it is the unscoped select/clear-all.
    public static func resolve(isSearching: Bool, allVisibleSelected: Bool, visibleCount: Int) -> Self {
        if isSearching {
            return allVisibleSelected ? .clearVisible(visibleCount) : .selectVisible(visibleCount)
        }
        return allVisibleSelected ? .clearAll : .selectAll
    }
}
