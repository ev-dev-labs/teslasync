//
//  LinearSidebar.Projection.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  The pure projection from the cached nav tree (the bound ``LinearSidebarInput``) + the tree state (which
//  sections are collapsed, the filter text) to the resolved, view-ready value the sidebar renders — the
//  native peer of everything the web component computes per render: the filtered sections, the
//  per-section expansion (`isExpanded`), the rendered-section set (`expandedSections`), the active-row
//  decision (`isActiveLinearPath`), the trailing badges (`trailingFor`), the per-row pin / unpin affordance
//  (`pinActionFor` + the favorites unpin button), and the empty-filter branch. The view is a pure function
//  of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it
//  takes the cached input + the latest tree state, runs the filter + the active-path rule, and derives the
//  Favorites group, the rendered sections, and the empty branches — collapsing exactly the same conditional
//  renders the web component performs.
//

import Foundation

// MARK: - LinearSidebarPinAffordance (web `pinActionFor` + favorites unpin)

/// The pin / unpin affordance a row carries — the native peer of the web hover actions. `.none` is a row
/// with no action (a section row already in Favorites — web `pinActionFor` returns `null`); `.pin` is the
/// star button on an un-pinned section row; `.unpin` is the close button on a Favorites row.
public enum LinearSidebarPinAffordance: Sendable, Equatable {
    /// No affordance — web `pinActionFor` returns `null` for an already-pinned section row.
    case none
    /// Pin-to-favorites — web `<Button aria-label="Pin {{page}} to favorites">` (carries the a11y label).
    case pin(accessibilityLabel: String)
    /// Unpin-from-favorites — web `<Button aria-label="Unpin {{page}}">` (carries the a11y label).
    case unpin(accessibilityLabel: String)
}

// MARK: - LinearSidebarRow (web `<LinearNavLink>`)

/// One resolved nav row — the native peer of the web `<LinearNavLink>` props. It carries the already
/// resolved label, the active flag (the 2px accent bar), the trailing badge, and the pin / unpin
/// affordance, so the view renders it without recomputing anything.
public struct LinearSidebarRow: Sendable, Equatable, Identifiable {
    /// The row identity — `pinned-<path>` in Favorites, `<path>` in a section (web list `key`s). A pinned
    /// row appears in BOTH groups, so the path alone is not unique across the tree.
    public let id: String
    /// The route path — web `to`.
    public let path: String
    /// The resolved, localized label — web `navLabel(item.label)`.
    public let title: String
    /// The SF Symbol glyph — web `icon`.
    public let systemImage: String
    /// `true` when this row is the active page — web `isActiveLinearPath` (drives the accent bar).
    public let isActive: Bool
    /// The resolved trailing badge — web `trailingFor(to)`.
    public let trailing: LinearSidebarTrailing
    /// The pin / unpin affordance — web `pinActionFor` / the favorites unpin button.
    public let pinAffordance: LinearSidebarPinAffordance
    /// The product-tour anchor — web `dataTour` (kept as an accessibility identifier).
    public let dataTour: String?

    public init(
        id: String,
        path: String,
        title: String,
        systemImage: String,
        isActive: Bool,
        trailing: LinearSidebarTrailing,
        pinAffordance: LinearSidebarPinAffordance,
        dataTour: String?
    ) {
        self.id = id
        self.path = path
        self.title = title
        self.systemImage = systemImage
        self.isActive = isActive
        self.trailing = trailing
        self.pinAffordance = pinAffordance
        self.dataTour = dataTour
    }
}

// MARK: - LinearSidebarSectionPresentation (web rendered section)

/// One rendered section — the native peer of one entry in the web `expandedSections` map. It carries the
/// resolved header title, the filtered row count (web `count={section.items.length}`), the expansion flag
/// (web `isExpanded`), and the resolved rows (shown only while `isExpanded`).
public struct LinearSidebarSectionPresentation: Sendable, Equatable, Identifiable {
    /// The section's stable identity — the collapse key.
    public let id: String
    /// The resolved, localized header title.
    public let title: String
    /// The filtered row count shown in the header — web `count={section.items.length}`.
    public let count: Int
    /// `true` when the section is open — web `isExpanded` (collapse state, or forced open under a filter).
    public let isExpanded: Bool
    /// The resolved rows (already filtered), rendered only while `isExpanded`.
    public let rows: [LinearSidebarRow]

    public init(id: String, title: String, count: Int, isExpanded: Bool, rows: [LinearSidebarRow]) {
        self.id = id
        self.title = title
        self.count = count
        self.isExpanded = isExpanded
        self.rows = rows
    }
}

// MARK: - LinearSidebarFavorites (web pinned "Favorites" group)

/// The resolved Favorites group — the native peer of the web pinned block (shown whenever ≥ 1 item is
/// pinned, never collapsible). Its rows are filtered by the same tree filter; the group header stays even
/// when the filter hides every pinned row (web renders the header then maps the filtered list).
public struct LinearSidebarFavorites: Sendable, Equatable {
    /// The localized group label — web `t('nav.favorites', 'Favorites')`.
    public let label: String
    /// The filtered pinned rows, each carrying an unpin affordance.
    public let rows: [LinearSidebarRow]

    public init(label: String, rows: [LinearSidebarRow]) {
        self.label = label
        self.rows = rows
    }
}

// MARK: - LinearSidebarPresentation (the whole resolved sidebar)

/// The resolved, view-ready projection of the whole sidebar — the native peer of the web component's full
/// render. The view reads this and draws; it never recomputes filtering, expansion, or active state.
public struct LinearSidebarPresentation: Sendable, Equatable {
    /// The Favorites group, or `nil` when nothing is pinned — web `pinnedItems.length > 0 && (...)`.
    public let favorites: LinearSidebarFavorites?
    /// The rendered sections (those with ≥ 1 matching row) — web `expandedSections`.
    public let sections: [LinearSidebarSectionPresentation]
    /// `true` when a tree filter is active — web `filterTokens.length > 0`.
    public let isFilterActive: Bool
    /// `true` when a filter is active but no section has a match — web `filterTokens.length > 0 &&
    /// expandedSections.length === 0` (drives the "No matches." + "Clear filter" block).
    public let isEmptyFilterResult: Bool
    /// `true` when there is genuinely nothing to show (no favorites, no sections, no active filter). The
    /// web leaves an empty `<nav>` here; this surface renders a quiet empty state (never a blank box).
    public let isEmpty: Bool
    /// The nav region accessibility label — web `t('nav.sidebar', 'Sidebar navigation')`.
    public let sidebarLabel: String
    /// The "No matches." message — web `t('nav.filterNoMatch', 'No matches.')`.
    public let emptyFilterMessage: String
    /// The "Clear filter" button label — web `t('nav.filterClear', 'Clear filter')`.
    public let clearFilterLabel: String
    /// The empty-state message for the no-data branch (native-only graceful empty, never a blank box).
    public let emptyMessage: String

    public init(
        favorites: LinearSidebarFavorites?,
        sections: [LinearSidebarSectionPresentation],
        isFilterActive: Bool,
        isEmptyFilterResult: Bool,
        isEmpty: Bool,
        sidebarLabel: String,
        emptyFilterMessage: String,
        clearFilterLabel: String,
        emptyMessage: String
    ) {
        self.favorites = favorites
        self.sections = sections
        self.isFilterActive = isFilterActive
        self.isEmptyFilterResult = isEmptyFilterResult
        self.isEmpty = isEmpty
        self.sidebarLabel = sidebarLabel
        self.emptyFilterMessage = emptyFilterMessage
        self.clearFilterLabel = clearFilterLabel
        self.emptyMessage = emptyMessage
    }
}

// MARK: - LinearSidebarTreeState (web `collapsed` + `filter`)

/// The model-owned local tree state — the native peer of the web `collapsed: Set<string>` +
/// `filter: string` `useState`s. Pure value type so the projection stays a function of (input, state).
public struct LinearSidebarTreeState: Sendable, Equatable {
    /// The collapsed section ids — web `collapsed` (a section is open when NOT in this set).
    public let collapsedSectionIDs: Set<String>
    /// The raw filter text — web `filter`.
    public let filterText: String

    public init(collapsedSectionIDs: Set<String> = [], filterText: String = "") {
        self.collapsedSectionIDs = collapsedSectionIDs
        self.filterText = filterText
    }

    /// The neutral first state — nothing collapsed, no filter.
    public static let initial = LinearSidebarTreeState()
}

// MARK: - LinearSidebarProjection (cached input + tree state → resolved presentation)

/// Pure projection from the cached input + the tree state to the resolved presentation. Runs the filter,
/// the active-path rule, and the badge / pin rules — the verbatim native peer of the web render.
public enum LinearSidebarProjection {
    /// Projects the input + tree state into the resolved presentation.
    public static func resolve(
        input: LinearSidebarInput,
        tree: LinearSidebarTreeState,
        localize: LinearSidebarLocalize
    ) -> LinearSidebarPresentation {
        let tokens = LinearSidebarFilter.tokens(tree.filterText)
        let favorites = resolveFavorites(input: input, tokens: tokens, localize: localize)
        let sections = resolveSections(input: input, tree: tree, tokens: tokens, localize: localize)
        let isFilterActive = !tokens.isEmpty
        let isEmptyFilterResult = isFilterActive && sections.isEmpty
        let isEmpty = favorites == nil && sections.isEmpty && !isFilterActive
        return LinearSidebarPresentation(
            favorites: favorites,
            sections: sections,
            isFilterActive: isFilterActive,
            isEmptyFilterResult: isEmptyFilterResult,
            isEmpty: isEmpty,
            sidebarLabel: localize("nav.sidebar", "Sidebar navigation"),
            emptyFilterMessage: localize("nav.filterNoMatch", "No matches."),
            clearFilterLabel: localize("nav.filterClear", "Clear filter"),
            emptyMessage: localize("nav.empty", "No navigation items.")
        )
    }

    /// Builds the Favorites group — web pinned block. Present whenever ≥ 1 item is pinned (even if the
    /// filter hides every row); rows are filtered by the tree filter and each carries an unpin affordance.
    private static func resolveFavorites(
        input: LinearSidebarInput,
        tokens: [String],
        localize: LinearSidebarLocalize
    ) -> LinearSidebarFavorites? {
        guard !input.pinnedItems.isEmpty else { return nil }
        let rows = input.pinnedItems.compactMap { item -> LinearSidebarRow? in
            let title = item.title(localize: localize)
            guard LinearSidebarFilter.matches(title, tokens: tokens) else { return nil }
            return row(item: item, title: title, idPrefix: "pinned-", input: input, localize: localize)
        }
        return LinearSidebarFavorites(label: localize("nav.favorites", "Favorites"), rows: rows)
    }

    /// Builds the rendered sections — web `filteredSections.filter(items.length > 0)`. Each kept section
    /// gets its filtered count, its expansion flag, and its filtered rows.
    private static func resolveSections(
        input: LinearSidebarInput,
        tree: LinearSidebarTreeState,
        tokens: [String],
        localize: LinearSidebarLocalize
    ) -> [LinearSidebarSectionPresentation] {
        input.sections.compactMap { section in
            let rows = section.items.compactMap { item -> LinearSidebarRow? in
                let title = item.title(localize: localize)
                guard LinearSidebarFilter.matches(title, tokens: tokens) else { return nil }
                return row(item: item, title: title, idPrefix: "", input: input, localize: localize)
            }
            guard !rows.isEmpty else { return nil }
            return LinearSidebarSectionPresentation(
                id: section.id,
                title: section.title(localize: localize),
                count: rows.count,
                isExpanded: isExpanded(section.id, tree: tree, filterActive: !tokens.isEmpty),
                rows: rows
            )
        }
    }

    /// A section is open when a filter is active (every matching section force-expands so results show
    /// immediately) OR, with no filter, when it is not in the collapsed set — web `isExpanded`.
    private static func isExpanded(_ sectionID: String, tree: LinearSidebarTreeState, filterActive: Bool) -> Bool {
        if filterActive { return true }
        return !tree.collapsedSectionIDs.contains(sectionID)
    }

    /// Builds one resolved row — the active flag, the trailing badge, and the pin / unpin affordance. The
    /// `idPrefix` (`pinned-` for Favorites) keeps a pinned row's two appearances distinctly identifiable.
    private static func row(
        item: LinearSidebarItem,
        title: String,
        idPrefix: String,
        input: LinearSidebarInput,
        localize: LinearSidebarLocalize
    ) -> LinearSidebarRow {
        let pin = affordance(
            item: item,
            title: title,
            isFavorite: !idPrefix.isEmpty,
            input: input,
            localize: localize
        )
        return LinearSidebarRow(
            id: idPrefix + item.path,
            path: item.path,
            title: title,
            systemImage: item.systemImage,
            isActive: LinearSidebarActivePath.isActive(pathname: input.activePath, path: item.path),
            trailing: input.trailing(for: item.path, localize: localize),
            pinAffordance: pin,
            dataTour: item.dataTour
        )
    }

    /// The pin / unpin affordance — `.unpin` for a Favorites row, `.none` for an already-pinned section
    /// row (web `pinActionFor` returns `null`), `.pin` otherwise. Labels are i18next-interpolated.
    private static func affordance(
        item: LinearSidebarItem,
        title: String,
        isFavorite: Bool,
        input: LinearSidebarInput,
        localize: LinearSidebarLocalize
    ) -> LinearSidebarPinAffordance {
        if isFavorite {
            let label = LinearSidebarInterpolation.format(
                localize("nav.unpinPage", "Unpin {{page}}"), ["page": title]
            )
            return .unpin(accessibilityLabel: label)
        }
        if input.pinnedPaths.contains(item.path) { return .none }
        let label = LinearSidebarInterpolation.format(
            localize("nav.pinPage", "Pin {{page}} to favorites"), ["page": title]
        )
        return .pin(accessibilityLabel: label)
    }
}
