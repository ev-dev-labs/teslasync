//
//  NotionSidebar.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  The SwiftUI surface — the parity of components/layout/sidebar/NotionSidebar.tsx. The web component is a
//  Notion-inspired replacement for the default nav block: a single quiet column rendering a pinned
//  "Favorites" group (whenever ≥ 1 item is pinned) above a PERMANENT "Pages" group of collapsible sections.
//  Each section is one clickable line (caret + glyph + title + count); the active page is marked only by a
//  quiet background fill (NO accent bar, NO bold — Notion is the quietest possible); every row carries a pin
//  (star) / unpin (close) affordance; and an inline tree-filter whittles the tree down (force-expanding every
//  section with a match) and collapses to a "No matches." + "Clear filter" branch when nothing matches.
//
//  The web component owns the filter STATE + the "Clear filter" affordance but renders its typing surface
//  upstream (its own JSX has no `<input>`); the native peer realizes that documented inline tree-filter as a
//  quiet search field at the top of the column, so every filter branch the source defines (active,
//  empty-match, clear) is reachable in one self-contained surface. Navigation is forwarded through
//  `onNavigate` (the native peer of the web `GuardedNavLink to=` + the `onItemSelect` drawer-close), and pin
//  / unpin are forwarded by the model to the bound nav state holder (web `onPin` / `onUnpin`).
//
//  All logic lives in the pure projection behind ``NotionSidebarModel``; this view is a pure function of
//  `model.presentation`. No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9), copy
//  resolves through P1/S10, and the nav region carries the localized accessibility label.
//

import SwiftUI

// MARK: - NotionSidebar (web `<NotionSidebar>`)

/// The Notion-style sidebar surface. Owns a ``NotionSidebarModel`` (the tree state + the resolved
/// presentation) and renders the inline filter field, the Favorites group, the permanent Pages group of
/// collapsible sections, and the empty branches. Reading `model.presentation` registers SwiftUI observation,
/// so the column redraws when the filter, the collapse state, or the bound input changes.
public struct NotionSidebar: View {
    @State private var model: NotionSidebarModel
    private let onNavigate: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Production initializer — binds the nav input + the navigation / pin / unpin callbacks (the P1/S8
    /// binding to the nav state holder that owns the pinned list and the router).
    public init(
        input: NotionSidebarInput,
        onNavigate: @escaping (String) -> Void = { _ in },
        onPin: @escaping @MainActor (String) -> Void = { _ in },
        onUnpin: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: NotionSidebarModel(input: input, onPin: onPin, onUnpin: onUnpin))
        self.onNavigate = onNavigate
    }

    /// Model-injecting initializer — used by previews + tests that drive a spy telemetry / fixed input.
    public init(model: NotionSidebarModel, onNavigate: @escaping (String) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            filterField
            tree
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.top, TSSpacing.sm)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.bg)
        .onAppear { model.start() }
    }

    // MARK: Filter field (native realization of the web inline tree-filter)

    private var filterField: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: filterBinding,
                prompt: Text(verbatim: model.localizedFilterPrompt)
            ) {
                Text(verbatim: model.localizedFilterPrompt)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .autocorrectionDisabled()
            .accessibilityLabel(Text(verbatim: model.localizedFilterPrompt))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(Color.TS.textPrimary.opacity(0.05))
        )
        .padding(.horizontal, TSSpacing.xs)
    }

    /// The filter field's two-way binding — reads the model's filter text, routes edits through `setFilter`
    /// so the projection re-derives expansion + matches.
    private var filterBinding: Binding<String> {
        Binding(get: { model.filterText }, set: { model.setFilter($0) })
    }

    // MARK: Tree (Favorites + permanent Pages group + empty branches)

    private var tree: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 1) {
                if let favorites = model.presentation.favorites {
                    favoritesGroup(favorites)
                }
                // The "Pages" group label is ALWAYS shown — web renders it unconditionally below Favorites.
                NotionSidebarGroupLabel(label: model.presentation.pagesLabel)
                sections
                if model.presentation.isEmptyFilterResult {
                    NotionSidebarEmptyFilter(
                        message: model.presentation.emptyFilterMessage,
                        clearLabel: model.presentation.clearFilterLabel,
                        onClear: { model.clearFilter() }
                    )
                }
                if model.presentation.isEmpty {
                    NotionSidebarEmptyState(message: model.presentation.emptyMessage)
                }
            }
            .padding(.bottom, TSSpacing.md)
        }
        .scrollContentBackground(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.presentation.sidebarLabel))
    }

    /// The permanent Favorites group — a sentence-case label + the filtered pinned rows (each with an unpin
    /// action). Favorites rows sit at the shallow indent (web `ps-2`).
    private func favoritesGroup(_ favorites: NotionSidebarFavorites) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            NotionSidebarGroupLabel(label: favorites.label)
            ForEach(favorites.rows) { row in
                navRow(row)
            }
        }
    }

    /// The collapsible sections — each section row toggles its section; sub-rows render only while expanded
    /// and sit at the deeper Notion indent (web `ps-7`) under the parent glyph.
    private var sections: some View {
        ForEach(model.presentation.sections) { section in
            VStack(alignment: .leading, spacing: 1) {
                NotionSidebarSectionRow(
                    title: section.title,
                    glyphSystemImage: section.glyphSystemImage,
                    count: section.count,
                    isExpanded: section.isExpanded,
                    onToggle: { model.toggleSection(section.id) }
                )
                if section.isExpanded {
                    ForEach(section.rows) { row in
                        navRow(row)
                            .padding(.leading, TSSpacing.xl)
                    }
                }
            }
            .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: section.isExpanded)
        }
    }

    /// One nav row wired to navigation + the pin / unpin intent.
    private func navRow(_ row: NotionSidebarRow) -> some View {
        NotionSidebarNavRow(
            row: row,
            onSelect: { onNavigate(row.path) },
            onPinToggle: { togglePin(row) }
        )
    }

    /// Routes the row's affordance to the correct model intent — `.pin` pins, `.unpin` unpins.
    private func togglePin(_ row: NotionSidebarRow) {
        switch row.pinAffordance {
        case .pin: model.pin(row.path)
        case .unpin: model.unpin(row.path)
        }
    }
}
