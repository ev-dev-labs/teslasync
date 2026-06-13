//
//  NotionSidebar.Projection.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  The pure projection from the cached nav tree (the bound ``NotionSidebarInput``) + the tree state (which
//  sections are collapsed, the filter text) to the resolved, view-ready value the sidebar renders — the
//  native peer of everything the web component computes per render: the filtered sections, the per-section
//  expansion (`isExpanded`), the rendered-section set (`expandedSections`), the per-section glyph
//  (`sectionGlyph` — the first item's icon), the active-row decision (`isActiveNotionPath`), the trailing
//  badges (`trailingFor`), the per-row pin / unpin affordance (`pinAction` + the favorites unpin button), and
//  the empty-filter branch. The view is a pure function of this value; every branch is unit tested.
//
//  This is the surface's data adapter in the "cached → projection" sense the acceptance calls for: it takes
//  the cached input + the latest tree state, runs the filter + the active-path rule, and derives the
//  Favorites group, the rendered sections (each with its glyph), and the empty branches — collapsing exactly
//  the same conditional renders the web component performs.
//
//  Notion vs. Linear (the parity differences that live HERE):
//    • Every section row carries an affordance: `pinAction` returns a star (pin) on an un-pinned row and a
//      close (unpin) on an already-pinned row — there is NO "no affordance" branch (web `pinAction` always
//      renders a button). Favorites rows always carry unpin.
//    • The pin label is `Pin {{page}}` (web `nav.pinPage` default — NOT "to favorites").
//    • Each rendered section carries the glyph of its first (filtered) row — web `sectionGlyph`.
//

import Foundation

// MARK: - NotionSidebarPinAffordance (web `pinAction` + favorites unpin)

/// The pin / unpin affordance a row carries — the native peer of the web hover actions. Notion renders one
/// on EVERY row (unlike Linear's `.none`): `.pin` is the star button on an un-pinned section row; `.unpin`
/// is the close button on a Favorites row or an already-pinned section row.
public enum NotionSidebarPinAffordance: Sendable, Equatable {
    /// Pin-to-favorites — web `<Button aria-label="Pin {{page}}">{<Icons.star/>}` (carries the a11y label).
    case pin(accessibilityLabel: String)
    /// Unpin-from-favorites — web `<Button aria-label="Unpin {{page}}">{<Icons.close/>}` (a11y label).
    case unpin(accessibilityLabel: String)
}

// MARK: - NotionSidebarRow (web `<NotionRow>`)

/// One resolved nav row — the native peer of the web `<NotionRow>` props. It carries the already resolved
/// label, the active flag (the quiet background fill — Notion has NO accent bar), the trailing badge, and the
/// pin / unpin affordance, so the view renders it without recomputing anything.
public struct NotionSidebarRow: Sendable, Equatable, Identifiable {
    /// The row identity — `fav-<path>` in Favorites, `<path>` in a section (web list `key`s). A pinned row
    /// appears in BOTH groups, so the path alone is not unique across the tree.
    public let id: String
    /// The route path — web `to`.
    public let path: String
    /// The resolved, localized label — web `navLabel(item.label)`.
    public let title: String
    /// The SF Symbol glyph — web `icon`.
    public let systemImage: String
    /// `true` when this row is the active page — web `isActiveNotionPath` (drives the quiet background fill).
    public let isActive: Bool
    /// The resolved trailing badge — web `trailingFor(to)`.
    public let trailing: NotionSidebarTrailing
    /// The pin / unpin affordance — web `pinAction` / the favorites unpin button (always present in Notion).
    public let pinAffordance: NotionSidebarPinAffordance
    /// The product-tour anchor — web `dataTour` (kept as an accessibility identifier).
    public let dataTour: String?

    public init(
        id: String,
        path: String,
        title: String,
        systemImage: String,
        isActive: Bool,
        trailing: NotionSidebarTrailing,
        pinAffordance: NotionSidebarPinAffordance,
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

// MARK: - NotionSidebarSectionPresentation (web rendered section)

/// One rendered section — the native peer of one entry in the web `expandedSections` map. It carries the
/// resolved header title, the section glyph (web `sectionGlyph` — the first filtered row's icon), the
/// filtered row count (web `count={section.items.length}`), the expansion flag (web `isExpanded`), and the
/// resolved rows (shown only while `isExpanded`).
public struct NotionSidebarSectionPresentation: Sendable, Equatable, Identifiable {
    /// The section's stable identity — the collapse key.
    public let id: String
    /// The resolved, localized header title.
    public let title: String
    /// The section glyph — the first filtered row's SF Symbol (web `sectionGlyph(section).icon`).
    public let glyphSystemImage: String
    /// The filtered row count shown in the header — web `count={section.items.length}`.
    public let count: Int
    /// `true` when the section is open — web `isExpanded` (collapse state, or forced open under a filter).
    public let isExpanded: Bool
    /// The resolved rows (already filtered), rendered only while `isExpanded`.
    public let rows: [NotionSidebarRow]

    public init(
        id: String,
        title: String,
        glyphSystemImage: String,
        count: Int,
        isExpanded: Bool,
        rows: [NotionSidebarRow]
    ) {
        self.id = id
        self.title = title
        self.glyphSystemImage = glyphSystemImage
        self.count = count
        self.isExpanded = isExpanded
        self.rows = rows
    }
}

// MARK: - NotionSidebarFavorites (web pinned "Favorites" group)

/// The resolved Favorites group — the native peer of the web pinned block (shown whenever ≥ 1 item is
/// pinned, never collapsible). Its rows are filtered by the same tree filter; the group header stays even
/// when the filter hides every pinned row (web renders the header then maps the filtered list).
public struct NotionSidebarFavorites: Sendable, Equatable {
    /// The localized group label — web `t('nav.favorites', 'Favorites')`.
    public let label: String
    /// The filtered pinned rows, each carrying an unpin affordance.
    public let rows: [NotionSidebarRow]

    public init(label: String, rows: [NotionSidebarRow]) {
        self.label = label
        self.rows = rows
    }
}

// MARK: - NotionSidebarPresentation (the whole resolved sidebar)

/// The resolved, view-ready projection of the whole sidebar — the native peer of the web component's full
/// render. The view reads this and draws; it never recomputes filtering, expansion, or active state.
public struct NotionSidebarPresentation: Sendable, Equatable {
    /// The Favorites group, or `nil` when nothing is pinned — web `pinnedItems.length > 0 && (...)`.
    public let favorites: NotionSidebarFavorites?
    /// The localized "Pages" group label — web `t('nav.pages', 'Pages')` (ALWAYS shown, unlike Favorites).
    public let pagesLabel: String
    /// The rendered sections (those with ≥ 1 matching row) — web `expandedSections`.
    public let sections: [NotionSidebarSectionPresentation]
    /// `true` when a tree filter is active — web `filterTokens.length > 0`.
    public let isFilterActive: Bool
    /// `true` when a filter is active but no section has a match — web `filterTokens.length > 0 &&
    /// expandedSections.length === 0` (drives the "No matches." + "Clear filter" block).
    public let isEmptyFilterResult: Bool
    /// `true` when there is genuinely nothing to show (no favorites, no sections, no active filter). The web
    /// leaves a bare "Pages" label here; this surface renders a quiet empty state (never a blank box).
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
        favorites: NotionSidebarFavorites?,
        pagesLabel: String,
        sections: [NotionSidebarSectionPresentation],
        isFilterActive: Bool,
        isEmptyFilterResult: Bool,
        isEmpty: Bool,
        sidebarLabel: String,
        emptyFilterMessage: String,
        clearFilterLabel: String,
        emptyMessage: String
    ) {
        self.favorites = favorites
        self.pagesLabel = pagesLabel
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

// MARK: - NotionSidebarTreeState (web `collapsed` + `filter`)

/// The model-owned local tree state — the native peer of the web `collapsed: Set<string>` + `filter: string`
/// `useState`s. Pure value type so the projection stays a function of (input, state).
public struct NotionSidebarTreeState: Sendable, Equatable {
    /// The collapsed section ids — web `collapsed` (a section is open when NOT in this set).
    public let collapsedSectionIDs: Set<String>
    /// The raw filter text — web `filter`.
    public let filterText: String

    public init(collapsedSectionIDs: Set<String> = [], filterText: String = "") {
        self.collapsedSectionIDs = collapsedSectionIDs
        self.filterText = filterText
    }

    /// The neutral first state — nothing collapsed, no filter.
    public static let initial = NotionSidebarTreeState()
}

// MARK: - NotionSidebarProjection (cached input + tree state → resolved presentation)

/// Pure projection from the cached input + the tree state to the resolved presentation. Runs the filter, the
/// active-path rule, the section glyph, and the badge / pin rules — the verbatim native peer of the web
/// render.
public enum NotionSidebarProjection {
    /// The section glyph fallback — web `sectionGlyph` falls back to `Icons.home` for an item-less section.
    static let fallbackGlyph = "house"

    /// Projects the input + tree state into the resolved presentation.
    public static func resolve(
        input: NotionSidebarInput,
        tree: NotionSidebarTreeState,
        localize: NotionSidebarLocalize
    ) -> NotionSidebarPresentation {
        let tokens = NotionSidebarFilter.tokens(tree.filterText)
        let favorites = resolveFavorites(input: input, tokens: tokens, localize: localize)
        let sections = resolveSections(input: input, tree: tree, tokens: tokens, localize: localize)
        let isFilterActive = !tokens.isEmpty
        let isEmptyFilterResult = isFilterActive && sections.isEmpty
        let isEmpty = favorites == nil && sections.isEmpty && !isFilterActive
        return NotionSidebarPresentation(
            favorites: favorites,
            pagesLabel: localize("nav.pages", "Pages"),
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

    /// Builds the Favorites group — web pinned block. Present whenever ≥ 1 item is pinned (even if the filter
    /// hides every row); rows are filtered by the tree filter and each carries an unpin affordance.
    private static func resolveFavorites(
        input: NotionSidebarInput,
        tokens: [String],
        localize: NotionSidebarLocalize
    ) -> NotionSidebarFavorites? {
        guard !input.pinnedItems.isEmpty else { return nil }
        let rows = input.pinnedItems.compactMap { item -> NotionSidebarRow? in
            let title = item.title(localize: localize)
            guard NotionSidebarFilter.matches(title, tokens: tokens) else { return nil }
            return row(item: item, title: title, idPrefix: "fav-", input: input, localize: localize)
        }
        return NotionSidebarFavorites(label: localize("nav.favorites", "Favorites"), rows: rows)
    }

    /// Builds the rendered sections — web `expandedSections` (`filteredSections.filter(items.length > 0)`).
    /// Each kept section gets its glyph (first filtered row), its filtered count, its expansion flag, and its
    /// filtered rows.
    private static func resolveSections(
        input: NotionSidebarInput,
        tree: NotionSidebarTreeState,
        tokens: [String],
        localize: NotionSidebarLocalize
    ) -> [NotionSidebarSectionPresentation] {
        input.sections.compactMap { section in
            let rows = section.items.compactMap { item -> NotionSidebarRow? in
                let title = item.title(localize: localize)
                guard NotionSidebarFilter.matches(title, tokens: tokens) else { return nil }
                return row(item: item, title: title, idPrefix: "", input: input, localize: localize)
            }
            guard !rows.isEmpty else { return nil }
            return NotionSidebarSectionPresentation(
                id: section.id,
                title: section.title(localize: localize),
                glyphSystemImage: rows.first?.systemImage ?? fallbackGlyph,
                count: rows.count,
                isExpanded: isExpanded(section.id, tree: tree, filterActive: !tokens.isEmpty),
                rows: rows
            )
        }
    }

    /// A section is open when a filter is active (every matching section force-expands so results show
    /// immediately) OR, with no filter, when it is not in the collapsed set — web `isExpanded`.
    private static func isExpanded(
        _ sectionID: String,
        tree: NotionSidebarTreeState,
        filterActive: Bool
    ) -> Bool {
        if filterActive { return true }
        return !tree.collapsedSectionIDs.contains(sectionID)
    }

    /// Builds one resolved row — the active flag, the trailing badge, and the pin / unpin affordance. The
    /// `idPrefix` (`fav-` for Favorites) keeps a pinned row's two appearances distinctly identifiable.
    private static func row(
        item: NotionSidebarItem,
        title: String,
        idPrefix: String,
        input: NotionSidebarInput,
        localize: NotionSidebarLocalize
    ) -> NotionSidebarRow {
        let pin = affordance(
            item: item,
            title: title,
            isFavorite: !idPrefix.isEmpty,
            input: input,
            localize: localize
        )
        return NotionSidebarRow(
            id: idPrefix + item.path,
            path: item.path,
            title: title,
            systemImage: item.systemImage,
            isActive: NotionSidebarActivePath.isActive(pathname: input.activePath, path: item.path),
            trailing: input.trailing(for: item.path, localize: localize),
            pinAffordance: pin,
            dataTour: item.dataTour
        )
    }

    /// The pin / unpin affordance — Notion renders one on EVERY row: `.unpin` for a Favorites row OR an
    /// already-pinned section row (web `pinned ? close : star`), `.pin` otherwise. Labels are
    /// i18next-interpolated (`Pin {{page}}` / `Unpin {{page}}`).
    private static func affordance(
        item: NotionSidebarItem,
        title: String,
        isFavorite: Bool,
        input: NotionSidebarInput,
        localize: NotionSidebarLocalize
    ) -> NotionSidebarPinAffordance {
        if isFavorite || input.pinnedPaths.contains(item.path) {
            let label = NotionSidebarInterpolation.format(
                localize("nav.unpinPage", "Unpin {{page}}"), ["page": title]
            )
            return .unpin(accessibilityLabel: label)
        }
        let label = NotionSidebarInterpolation.format(
            localize("nav.pinPage", "Pin {{page}}"), ["page": title]
        )
        return .pin(accessibilityLabel: label)
    }
}
