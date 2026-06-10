//
//  SignalCategoryTree.Tree.swift
//  TeslaSync — P4 feature view · 0265 · SignalCategoryTree (Apple)
//
//  The populated tree body: a scrollable list of category groups (web `role="tree"`),
//  each a disclosure header (chevron · tri-state checkbox · friendly label · count)
//  revealing its name-sorted signal leaves (checkbox · name · value-kind chip). The
//  no-results message renders here when the search filter eliminates every leaf
//  (web TreeSelect `noResultsState`). The lazy sparkline preview the web feeds each
//  leaf is its own surface (SignalSparklinePreview); this picker shows the leaf's
//  value-kind chip — the same descriptor data the web non-numeric preview falls
//  back to — as the trailing accessory.
//

import SwiftUI

// MARK: - Tree body

/// The scrollable category tree (web `role="tree"`), or the no-results message
/// when the active search filter eliminates every leaf.
struct SignalCategoryTreeBody: View {
    let model: SignalCategoryTreeModel

    private var groups: [SignalCategoryGroup] {
        model.filteredGroups
    }

    var body: some View {
        treeFrame {
            if groups.isEmpty {
                noResults
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groups) { group in
                            SignalCategoryGroupRow(model: model, group: group)
                            if model.isExpanded(group.id) {
                                ForEach(group.leaves) { leaf in
                                    SignalCategoryLeafRow(model: model, leaf: leaf)
                                }
                            }
                        }
                    }
                    .padding(.vertical, TSSpacing.xs)
                }
                .frame(maxHeight: 420)
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// Web TreeSelect `noResultsState`: `No matches for "{q}".`
    private var noResults: some View {
        Text(verbatim: SignalCategoryTreeStrings.noResults(model.searchText.trimmingCharacters(in: .whitespaces)))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.xl)
    }
}

// MARK: - Group header row

/// One category header: a disclosure control (chevron · label · count) and a
/// separate tri-state checkbox (web group `treeitem` with an intercepted checkbox).
struct SignalCategoryGroupRow: View {
    let model: SignalCategoryTreeModel
    let group: SignalCategoryGroup

    private var selectedCount: Int {
        model.selectedCount(in: group)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Button {
                model.toggleGroup(group.id)
            } label: {
                SignalCategoryCheckbox(state: model.selectionState(of: group))
            }
            .buttonStyle(.plain)
            .disabled(group.leaves.isEmpty)
            .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.toggleGroup(group.label)))

            Button {
                model.toggleExpanded(group.id)
            } label: {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: model.isExpanded(group.id) ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(width: 12)
                    Text(verbatim: group.label)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: TSSpacing.sm)
                    Text(verbatim: "\(selectedCount)/\(group.leaves.count)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .monospacedDigit()
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: SignalCategoryTreeAccessibility.groupLabel(
                group,
                selectedCount: selectedCount
            )))
            .accessibilityValue(Text(verbatim: expansionState))
            .accessibilityAddTraits(.isButton)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
    }

    private var expansionState: String {
        model.isExpanded(group.id)
            ? SignalCategoryTreeStrings.selectedTrait
            : SignalCategoryTreeStrings.notSelectedTrait
    }
}

// MARK: - Leaf row

/// One signal leaf: a checkbox, the canonical signal name (monospaced), and the
/// value-kind chip trailing accessory (web leaf `treeitem` + `renderLeafRight`).
struct SignalCategoryLeafRow: View {
    let model: SignalCategoryTreeModel
    let leaf: SignalCategoryLeaf

    private var isSelected: Bool {
        model.selectedSignals.contains(leaf.id)
    }

    var body: some View {
        Button {
            model.toggleLeaf(leaf.id)
        } label: {
            HStack(spacing: TSSpacing.sm) {
                SignalCategoryCheckbox(state: isSelected ? .all : .none)
                Text(verbatim: leaf.label)
                    .font(.system(.callout, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: TSSpacing.sm)
                SignalCategoryKindChip(kind: leaf.descriptor.valueKind)
            }
            .padding(.leading, TSSpacing.x2xl)
            .padding(.trailing, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: SignalCategoryTreeAccessibility.leafLabel(leaf, isSelected: isSelected)))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Tri-state checkbox

/// A tri-state checkbox glyph (web `Checkbox` checked / indeterminate / unchecked)
/// rendered with SF Symbols so it inherits Dynamic Type and the accent tint.
struct SignalCategoryCheckbox: View {
    let state: SignalSelectionState

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 16, weight: .regular))
            .foregroundStyle(tint)
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch state {
        case .all: "checkmark.square.fill"
        case .partial: "minus.square.fill"
        case .none: "square"
        }
    }

    private var tint: Color {
        state == .none ? Color.TS.textMuted : Color.TS.accent
    }
}

// MARK: - Value-kind chip

/// The leaf's trailing value-kind chip (web `SignalSparklinePreview` non-numeric
/// fallback: a compact uppercase `(kind)` token). Numeric kinds tint to the accent
/// so a numeric/non-numeric signal reads at a glance.
struct SignalCategoryKindChip: View {
    let kind: SignalValueKind

    var body: some View {
        Text(verbatim: kind.token)
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .tracking(TSTypeMetrics.labelTracking)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .foregroundStyle(kind.isNumeric ? Color.TS.accent : Color.TS.textMuted)
            .background(tone.opacity(0.10), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: SignalCategoryTreeStrings.kindLabel(kind.token)))
    }

    private var tone: Color {
        kind.isNumeric ? Color.TS.accent : Color.TS.textMuted
    }
}
