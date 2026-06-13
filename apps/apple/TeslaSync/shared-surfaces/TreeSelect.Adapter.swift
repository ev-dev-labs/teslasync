//
//  TreeSelect.Adapter.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The Foundation-only core for the tri-state tree multi-select — the SwiftUI parity of
//  `components/forms/TreeSelect.tsx`. Everything here is pure (no SwiftUI, no store, no bundle), so the
//  whole filter / toggle / tri-state / counting contract is unit-tested in isolation against the web's own
//  behaviour. It owns the surface identity (the diagnostics slug), the two-level data model (`TreeSelectGroup`
//  → `TreeSelectLeaf`), the search filter (web `filterGroups`: a group-label match keeps every leaf,
//  otherwise only the leaves whose label matches; empty groups drop; an empty needle returns the input
//  unchanged), the flat focus-row sequence (web `buildRows` for the roving-tabindex keyboard order), the
//  selection transforms (web `toggleLeaf` / `toggleGroup` / `toggleAllVisible`, preserving picks made
//  outside the current filter), the tri-state checkbox resolution (web `all` / `partial` / `none`), the
//  visible / total counters, and the i18next `{{token}}` interpolation. No `@Observable`, no view — each
//  rule is testable on its own.
//
//  Faithful-parity note: the web `TreeSelect<T>` is a CONTROLLED primitive — the parent owns `selectedIds`,
//  `searchValue`, and the optional `expandedGroupIds`, and receives `onChange` / `onSearchChange` /
//  `onExpandedChange`. The native core mirrors that: the engine is a set of pure value→value transforms,
//  and the state-holder (P1/S8) threads the parent's snapshot + lifecycle through them. The opaque web
//  `data: T` right-slot payload (badges / sparklines via `renderLeafRight` / `renderGroupRight`) is carried
//  as an optional `detail` string so a generic primitive keeps its trailing-accessory parity without
//  injecting arbitrary views into the pure core.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11). Kept
/// SwiftUI-free so the state-holder can emit telemetry without depending on the view layer.
public enum TreeSelectMeta {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = "TreeSelect"

    /// The skeleton row count rendered while the catalog loads (web four pulsing rows), surfaced here so
    /// the loading view holds no magic number.
    public static let loadingRowCount = 4

    /// The default body scroll height — the native stand-in for the web `max-h-[60vh]` cap.
    public static let defaultMaxBodyHeight: CGFloat = 360
}

// MARK: - Localization seam (web `t(key, default)`)

/// A `(key, fallback) -> String` resolver — the native shape of the web `useTranslation` `t(key,
/// fallback)` call. A plain closure so the pure core needs no bundle: the app passes the P1/S10 facade,
/// tests pass the identity-fallback resolver.
public typealias TreeSelectResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Data model (web `TreeLeaf<T>` / `TreeGroup<T>`)

/// One selectable leaf — the native peer of the web `TreeLeaf<T>`. `detail` carries the optional trailing
/// accessory (web `renderLeafRight`, e.g. a badge / sparkline summary); `isDisabled` marks a leaf that is
/// visible but uncheckable (web `getLeafDisabled`) with an optional `disabledReason` (web
/// `getLeafDisabledReason`) folded into the VoiceOver label.
public struct TreeSelectLeaf: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let detail: String?
    public let isDisabled: Bool
    public let disabledReason: String?

    public init(
        id: String,
        label: String,
        detail: String? = nil,
        isDisabled: Bool = false,
        disabledReason: String? = nil
    ) {
        self.id = id
        self.label = label
        self.detail = detail
        self.isDisabled = isDisabled
        self.disabledReason = disabledReason
    }
}

/// One top-level group — the native peer of the web `TreeGroup<T>`. `leaves` is the full set; the engine
/// filters in-place. `detail` is the optional group-header accessory (web `renderGroupRight`).
public struct TreeSelectGroup: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String
    public let detail: String?
    public let leaves: [TreeSelectLeaf]

    public init(id: String, label: String, detail: String? = nil, leaves: [TreeSelectLeaf]) {
        self.id = id
        self.label = label
        self.detail = detail
        self.leaves = leaves
    }
}

// MARK: - Tri-state (web `none` / `partial` / `all` checkbox)

/// A checkbox's tri-state — the native peer of the web `checked` / `indeterminate` pair. `all` renders the
/// filled box, `partial` the dash (web `indeterminate`), `none` the empty box.
public enum TreeSelectCheckState: Sendable, Equatable {
    case none
    case partial
    case all
}

// MARK: - Focus rows (web `buildRows` roving-tabindex order)

/// A row's kind in the flat focus sequence — a group header or one of its leaves.
public enum TreeSelectRowKind: Sendable, Equatable {
    case group
    case leaf
}

/// One entry in the flat, keyboard-navigable row sequence — the native peer of the web `RowDescriptor`.
/// Group rows always appear; leaf rows only when their group is expanded. `id` is a stable composite so a
/// `ForEach` / focus index can address it without ambiguity.
public struct TreeSelectRow: Sendable, Equatable, Identifiable {
    public let kind: TreeSelectRowKind
    public let groupID: String
    public let leafID: String?
    public let isDisabled: Bool

    public init(kind: TreeSelectRowKind, groupID: String, leafID: String? = nil, isDisabled: Bool = false) {
        self.kind = kind
        self.groupID = groupID
        self.leafID = leafID
        self.isDisabled = isDisabled
    }

    public var id: String {
        switch kind {
        case .group: "group:\(groupID)"
        case .leaf: "leaf:\(groupID):\(leafID ?? "")"
        }
    }
}

// MARK: - TreeSelectEngine (verbatim port of the web tree logic)

/// The pure tree engine — the native port of the web `filterGroups` / `buildRows` / `toggleLeaf` /
/// `toggleGroup` / `toggleAllVisible` plus the tri-state resolution, the visible / total counters, and the
/// i18next interpolation. Every function is deterministic and dependency-light, so the surface's behaviour
/// is asserted without a view or a store.
public enum TreeSelectEngine {
    // MARK: Filtering (web filterGroups)

    /// Filter `groups` by the search needle (case-insensitive substring against the leaf label). A group
    /// whose label matches keeps all its leaves; otherwise only the matching leaves are kept; groups with
    /// zero matches drop. An empty needle returns the input unchanged (web cheap-memo fast path).
    public static func filterGroups(_ groups: [TreeSelectGroup], needle: String) -> [TreeSelectGroup] {
        let query = needle.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return groups }
        var out: [TreeSelectGroup] = []
        for group in groups {
            let groupMatches = group.label.lowercased().contains(query)
            let leaves = groupMatches
                ? group.leaves
                : group.leaves.filter { $0.label.lowercased().contains(query) }
            guard !leaves.isEmpty else { continue }
            out.append(TreeSelectGroup(id: group.id, label: group.label, detail: group.detail, leaves: leaves))
        }
        return out
    }

    /// Whether a non-blank search is active (web `searchValue.trim().length > 0`).
    public static func isSearching(_ needle: String) -> Bool {
        !needle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: Focus rows (web buildRows)

    /// Compose the flat sequence of focusable rows — group rows always appear, leaf rows only when their
    /// group is expanded (web `buildRows`). `isExpanded` carries the search-forces-open rule from the caller.
    public static func buildRows(
        _ filtered: [TreeSelectGroup],
        isExpanded: (String) -> Bool
    ) -> [TreeSelectRow] {
        var rows: [TreeSelectRow] = []
        for group in filtered {
            rows.append(TreeSelectRow(kind: .group, groupID: group.id))
            guard isExpanded(group.id) else { continue }
            for leaf in group.leaves {
                rows.append(TreeSelectRow(kind: .leaf, groupID: group.id, leafID: leaf.id, isDisabled: leaf.isDisabled))
            }
        }
        return rows
    }

    // MARK: Selection transforms (web toggleLeaf / toggleGroup / toggleAllVisible)

    /// Toggle a single leaf — the web `toggleLeaf`. Appends when absent (preserving order), removes when
    /// present.
    public static func toggleLeaf(_ leafID: String, in selected: [String]) -> [String] {
        if selected.contains(leafID) {
            return selected.filter { $0 != leafID }
        }
        return selected + [leafID]
    }

    /// Toggle a set of ids as a unit — the shared core of `toggleGroup` / `toggleAllVisible`. When every id
    /// is already selected the whole set is cleared (web "clear visible"); otherwise the missing ids are
    /// appended, preserving the existing order and any picks made outside the set (web Set merge).
    public static func toggleIDs(_ ids: [String], in selected: [String]) -> [String] {
        guard !ids.isEmpty else { return selected }
        let prev = Set(selected)
        let allSelected = ids.allSatisfy { prev.contains($0) }
        if allSelected {
            let remove = Set(ids)
            return selected.filter { !remove.contains($0) }
        }
        var merged = selected
        for id in ids where !prev.contains(id) {
            merged.append(id)
        }
        return merged
    }

    /// Toggle a group — selects every visible-and-enabled leaf when any is unselected, otherwise clears
    /// them (web `toggleGroup`). Picks on disabled or filtered-out leaves are untouched.
    public static func toggleGroup(
        _ groupID: String,
        filtered: [TreeSelectGroup],
        selected: [String]
    ) -> [String] {
        guard let group = filtered.first(where: { $0.id == groupID }) else { return selected }
        return toggleIDs(enabledLeafIDs(in: [group]), in: selected)
    }

    /// Toggle every visible-and-enabled leaf across all filtered groups — the web `toggleAllVisible`
    /// ("Select visible" while searching).
    public static func toggleAllVisible(filtered: [TreeSelectGroup], selected: [String]) -> [String] {
        toggleIDs(enabledLeafIDs(in: filtered), in: selected)
    }

    // MARK: Counting + tri-state (web counts + checkbox resolution)

    /// Every leaf id across the filtered groups — including disabled (web `visibleLeafIds`, used for the
    /// top "all selected" check and the visible counter).
    public static func visibleLeafIDs(_ filtered: [TreeSelectGroup]) -> [String] {
        filtered.flatMap { group in group.leaves.map(\.id) }
    }

    /// Every visible-and-enabled leaf id (web filter `!isLeafDisabled`) — the toggle target set.
    public static func enabledLeafIDs(in groups: [TreeSelectGroup]) -> [String] {
        groups.flatMap { group in group.leaves.filter { !$0.isDisabled }.map(\.id) }
    }

    /// Total number of leaves across the unfiltered catalog (web `totalLeafCount`).
    public static func totalLeafCount(_ groups: [TreeSelectGroup]) -> Int {
        groups.reduce(0) { $0 + $1.leaves.count }
    }

    /// How many of `ids` are in the selection set.
    public static func selectedCount(of ids: [String], in selected: Set<String>) -> Int {
        ids.reduce(0) { selected.contains($1) ? $0 + 1 : $0 }
    }

    /// The tri-state for a group header (web `allGroupSelected` / `someGroupSelected`). `all` when the
    /// group has visible-enabled leaves and every one is selected; `partial` when at least one leaf (of any
    /// enablement) is selected but not all enabled ones; otherwise `none`.
    public static func groupCheckState(_ group: TreeSelectGroup, selected: Set<String>) -> TreeSelectCheckState {
        let enabled = group.leaves.filter { !$0.isDisabled }
        let selectedInGroup = selectedCount(of: group.leaves.map(\.id), in: selected)
        let allSelected = !enabled.isEmpty && enabled.allSatisfy { selected.contains($0.id) }
        if allSelected { return .all }
        return selectedInGroup > 0 ? .partial : .none
    }

    /// The tri-state for the top "select all visible" control (web `allVisibleSelected` /
    /// `someVisibleSelected`), computed over every visible leaf (including disabled, matching the web).
    public static func aggregateCheckState(
        visibleLeafIDs ids: [String],
        selected: Set<String>
    ) -> TreeSelectCheckState {
        guard !ids.isEmpty else { return .none }
        let count = selectedCount(of: ids, in: selected)
        if count == ids.count { return .all }
        return count > 0 ? .partial : .none
    }

    // MARK: Interpolation (web i18next `{{token}}`)

    /// Replace `{{token}}` markers in a resolved template — the native port of i18next interpolation, so
    /// the per-surface strings keep the web's `{{count}}` / `{{total}}` / `{{label}}` shapes.
    public static func interpolate(_ template: String, _ values: [String: String]) -> String {
        var result = template
        for (key, value) in values {
            result = result.replacingOccurrences(of: "{{\(key)}}", with: value)
        }
        return result
    }

    // MARK: A11y live-region padding (web sr-only summary re-read)

    /// U+200B ZERO WIDTH SPACE — invisible on screen and unspoken, used to force the assistive technology
    /// to re-read an identical consecutive selection-summary announcement (the web sr-only live region).
    public static let zeroWidthSpace = "\u{200B}"

    /// The rotating dedupe suffix — `sequence mod 4` zero-width spaces, so a repeated summary is still
    /// re-spoken. The modulo keeps the suffix bounded.
    public static func announcementPadding(sequence: Int) -> String {
        let count = ((sequence % 4) + 4) % 4
        return String(repeating: zeroWidthSpace, count: count)
    }
}
