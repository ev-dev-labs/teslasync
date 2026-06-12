//
//  LinearSidebar.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  The SwiftUI surface — the parity of components/layout/sidebar/LinearSidebar.tsx. The web component is a
//  Linear / Notion-inspired replacement for the default nav block: a single quiet column rendering a
//  permanent "Favorites" group (whenever ≥ 1 item is pinned) above a tree of collapsible sections, with a
//  2pt left accent bar marking the active page, quiet trailing badges, per-row pin / unpin affordances,
//  and an inline tree-filter that whittles the tree down (force-expanding every section with a match) and
//  collapses to a "No matches." + "Clear filter" branch when nothing matches.
//
//  The web component owns the filter STATE + the "Clear filter" affordance but renders its typing surface
//  upstream (its own JSX has no `<input>`); the native peer realizes that documented inline tree-filter as
//  a quiet search field at the top of the column, so every filter branch the source defines (active,
//  empty-match, clear) is reachable in one self-contained surface. Navigation is forwarded through
//  `onNavigate` (the native peer of the web `GuardedNavLink to=` + the `onItemSelect` drawer-close), and
//  pin / unpin are forwarded by the model to the bound nav state holder (web `onPin` / `onUnpin`).
//
//  All logic lives in the pure projection behind ``LinearSidebarModel``; this view is a pure function of
//  `model.presentation`. No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9),
//  copy resolves through P1/S10, and the nav region carries the localized accessibility label.
//

import SwiftUI

// MARK: - LinearSidebar (web `<LinearSidebar>`)

/// The Linear / Notion-style sidebar surface. Owns a ``LinearSidebarModel`` (the tree state + the resolved
/// presentation) and renders the inline filter field, the Favorites group, the collapsible sections, and
/// the empty branches. Reading `model.presentation` registers SwiftUI observation, so the column redraws
/// when the filter, the collapse state, or the bound input changes.
public struct LinearSidebar: View {
    @State private var model: LinearSidebarModel
    private let onNavigate: (String) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Production initializer — binds the nav input + the navigation / pin / unpin callbacks (the P1/S8
    /// binding to the nav state holder that owns the pinned list and the router).
    public init(
        input: LinearSidebarInput,
        onNavigate: @escaping (String) -> Void = { _ in },
        onPin: @escaping @MainActor (String) -> Void = { _ in },
        onUnpin: @escaping @MainActor (String) -> Void = { _ in }
    ) {
        _model = State(initialValue: LinearSidebarModel(input: input, onPin: onPin, onUnpin: onUnpin))
        self.onNavigate = onNavigate
    }

    /// Model-injecting initializer — used by previews + tests that drive a spy telemetry / fixed input.
    public init(model: LinearSidebarModel, onNavigate: @escaping (String) -> Void = { _ in }) {
        _model = State(initialValue: model)
        self.onNavigate = onNavigate
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            filterField
            tree
        }
        .padding(.horizontal, TSSpacing.sm)
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
    }

    /// The filter field's two-way binding — reads the model's filter text, routes edits through
    /// `setFilter` so the projection re-derives expansion + matches.
    private var filterBinding: Binding<String> {
        Binding(get: { model.filterText }, set: { model.setFilter($0) })
    }

    // MARK: Tree (Favorites + sections + empty branches)

    private var tree: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: TSSpacing.sm) {
                if let favorites = model.presentation.favorites {
                    favoritesGroup(favorites)
                }
                sections
                if model.presentation.isEmptyFilterResult {
                    LinearSidebarEmptyFilter(
                        message: model.presentation.emptyFilterMessage,
                        clearLabel: model.presentation.clearFilterLabel,
                        onClear: { model.clearFilter() }
                    )
                }
                if model.presentation.isEmpty {
                    LinearSidebarEmptyState(message: model.presentation.emptyMessage)
                }
            }
            .padding(.bottom, TSSpacing.md)
        }
        .scrollContentBackground(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.presentation.sidebarLabel))
    }

    /// The permanent Favorites group — header + the filtered pinned rows (each with an unpin action).
    private func favoritesGroup(_ favorites: LinearSidebarFavorites) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            LinearSidebarFavoritesHeader(label: favorites.label)
            ForEach(favorites.rows) { row in
                navRow(row)
            }
        }
    }

    /// The collapsible sections — each header toggles its section; rows render only while expanded.
    private var sections: some View {
        ForEach(model.presentation.sections) { section in
            VStack(alignment: .leading, spacing: 1) {
                LinearSidebarSectionHeader(
                    title: section.title,
                    count: section.count,
                    isExpanded: section.isExpanded,
                    onToggle: { model.toggleSection(section.id) }
                )
                if section.isExpanded {
                    ForEach(section.rows) { row in
                        navRow(row)
                            .padding(.leading, TSSpacing.sm)
                    }
                }
            }
            .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: section.isExpanded)
        }
    }

    /// One nav row wired to navigation + the pin / unpin intent.
    private func navRow(_ row: LinearSidebarRow) -> some View {
        LinearSidebarNavRow(
            row: row,
            onSelect: { onNavigate(row.path) },
            onPinToggle: { togglePin(row) }
        )
    }

    /// Routes the row's affordance to the correct model intent — `.pin` pins, `.unpin` unpins, `.none`
    /// does nothing (an already-pinned section row has no action).
    private func togglePin(_ row: LinearSidebarRow) {
        switch row.pinAffordance {
        case .pin: model.pin(row.path)
        case .unpin: model.unpin(row.path)
        case .none: break
        }
    }
}
