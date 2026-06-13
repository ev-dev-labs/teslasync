//
//  TreeSelect.Rows.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The tree's row + body presentation, kept apart from the atomic controls for the lint length budget: the
//  group header row (web chevron + group checkbox + label + `selected/total` count + right slot), the leaf
//  row (web indented leaf with its decorative checkbox + label + right slot, including the
//  disabled-but-visible branch), the empty / no-results body (never a blank box), the scrollable bordered
//  body that dispatches the ready sub-state, the composed ready view, and the freshness chip (P4
//  connectivity axis). All chrome is token-driven (P1/S9); decorative glyphs are hidden from VoiceOver and
//  every interactive control carries an explicit label.
//

import SwiftUI

// MARK: - Group header row (web chevron + group checkbox + label + count + slot)

/// One group header — the disclosure chevron (toggles expansion), the tri-state group checkbox (toggles
/// every visible-enabled leaf), the label, the `selected/total` count, and the optional right slot. The
/// chevron + label area expand; the checkbox is a separate control, each with its own VoiceOver label.
struct TreeSelectGroupRow: View {
    let model: TreeSelectModel
    let group: TreeSelectGroup

    private var expanded: Bool {
        model.isExpanded(group.id)
    }

    private var checkState: TreeSelectCheckState {
        model.groupCheckState(group)
    }

    private var selectedCount: Int {
        model.groupSelectedCount(group)
    }

    private var toggleDisabled: Bool {
        group.leaves.allSatisfy(\.isDisabled)
    }

    private var expansionLabel: String {
        expanded ? TreeSelectStrings.collapse(label: group.label) : TreeSelectStrings.expand(label: group.label)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            chevronButton
            checkboxButton
            labelButton
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
    }

    private var chevronButton: some View {
        Button { model.toggleExpanded(group.id) } label: {
            Image(systemName: expanded ? "chevron.down" : "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 16)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: expansionLabel))
    }

    private var checkboxButton: some View {
        Button { model.toggleGroup(group.id) } label: {
            TreeSelectCheckGlyph(state: checkState, isDisabled: toggleDisabled)
        }
        .buttonStyle(.plain)
        .disabled(toggleDisabled)
        .accessibilityLabel(Text(verbatim: TreeSelectStrings.toggleGroup(label: group.label)))
        .accessibilityAddTraits(checkState == .all ? [.isButton, .isSelected] : .isButton)
    }

    private var labelButton: some View {
        Button { model.toggleExpanded(group.id) } label: {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: group.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: TreeSelectStrings.groupCount(selected: selectedCount, total: group.leaves.count))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
                if let detail = group.detail {
                    TreeSelectDetailBadge(text: detail)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            Text(verbatim: TreeSelectStrings.groupA11y(
                label: group.label,
                selected: selectedCount,
                total: group.leaves.count
            ))
        )
        .accessibilityHint(Text(verbatim: expansionLabel))
    }
}

// MARK: - Leaf row (web indented leaf + decorative checkbox + label + slot)

/// One leaf — the indented, tappable row that toggles the leaf (web leaf `treeitem`). The checkbox glyph
/// is decorative (web `aria-hidden`); the row carries the label (folding in the disabled reason) + the
/// selected trait. A disabled leaf is visible but dimmed and uncheckable (web `getLeafDisabled`).
struct TreeSelectLeafRow: View {
    let model: TreeSelectModel
    let leaf: TreeSelectLeaf

    private var selected: Bool {
        model.isLeafSelected(leaf.id)
    }

    private var accessibilityText: String {
        if leaf.isDisabled, let reason = leaf.disabledReason {
            return TreeSelectStrings.leafReason(label: leaf.label, reason: reason)
        }
        return leaf.label
    }

    var body: some View {
        Button {
            guard !leaf.isDisabled else { return }
            model.toggleLeaf(leaf.id)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                TreeSelectCheckGlyph(state: selected ? .all : .none, compact: true, isDisabled: leaf.isDisabled)
                    .accessibilityHidden(true)
                Text(verbatim: leaf.label)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                if let detail = leaf.detail {
                    TreeSelectDetailBadge(text: detail)
                }
            }
            .padding(.leading, TSSpacing.x2xl)
            .padding(.trailing, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .opacity(leaf.isDisabled ? 0.5 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(leaf.isDisabled)
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Empty / no-results body (never a blank box)

/// The empty-catalog / no-results body — a centered message, so the scroll area is never a blank box (web
/// `emptyState` / `noResultsState`).
struct TreeSelectEmptyBody: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(TSSpacing.x2xl)
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Scrollable body (web bordered scroll area)

/// The bordered scroll area dispatching the ready sub-state: the empty body, the no-results body, or the
/// tree of group + leaf rows (web `max-h-[60vh] overflow-y-auto` surface).
struct TreeSelectBodyView: View {
    let model: TreeSelectModel
    let maxHeight: CGFloat

    var body: some View {
        ScrollView {
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: maxHeight)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var content: some View {
        switch model.resolved.body {
        case .empty:
            TreeSelectEmptyBody(text: model.resolved.customEmptyText ?? TreeSelectStrings.empty)
        case let .noResults(query):
            TreeSelectEmptyBody(
                text: model.resolved.customNoResultsText ?? TreeSelectStrings.noResults(query: query)
            )
        case .tree:
            tree
        }
    }

    private var tree: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(model.resolved.filteredGroups) { group in
                TreeSelectGroupRow(model: model, group: group)
                if model.isExpanded(group.id) {
                    ForEach(group.leaves) { leaf in
                        TreeSelectLeafRow(model: model, leaf: leaf)
                    }
                }
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }
}

// MARK: - Ready view (search + header + body, never a blank box)

/// The `ready` render — the search field over the header over the bordered tree, folded into the shared
/// fade-in for entrance polish. The container carries the tree accessibility label + the live selection
/// summary as its value (the web sr-only region).
struct TreeSelectReadyView: View {
    let model: TreeSelectModel
    let maxHeight: CGFloat

    private var searchPrompt: String {
        model.resolved.customSearchPrompt ?? TreeSelectStrings.searchPrompt
    }

    private var ariaLabel: String {
        model.resolved.customAriaLabel ?? TreeSelectStrings.treeA11y
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TreeSelectSearchField(model: model, prompt: searchPrompt)
                TreeSelectHeader(model: model)
                TreeSelectBodyView(model: model, maxHeight: maxHeight)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: ariaLabel))
            .accessibilityValue(Text(verbatim: model.summaryText))
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the tree when the feed is not live — a colored dot + a label (`Stale`
/// / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot.
struct TreeSelectFreshnessChip: View {
    let connection: TreeSelectConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: TreeSelectStrings.live
        case .stale: TreeSelectStrings.stale
        case .offline: TreeSelectStrings.offline
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live: label
        case .stale: TreeSelectStrings.staleA11y
        case .offline: TreeSelectStrings.offlineA11y
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
