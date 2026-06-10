//
//  SignalCatalogPanel.Filters.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  The search + filter-mode + sort-mode controls (web `<Input>` + the All /
//  Stale Only / Active Only and Most Stale / A-Z / Category button groups). The
//  two groups sit side-by-side when they fit and stack on compact width via
//  `ViewThatFits`. Each segment carries its localized label + the selected a11y
//  trait. Token-driven (P1/S9); no Tailwind ports.
//

import SwiftUI

// MARK: - Filter bar (search + filter + sort)

/// The full control bar bound to the model's `search`, `filterMode`, `sortMode`.
struct SignalCatalogPanelFilterBar: View {
    @Bindable var model: SignalCatalogPanelModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            SignalCatalogPanelSearchField(text: $model.search)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    filterGroup
                    Spacer(minLength: TSSpacing.md)
                    sortGroup
                }
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    filterGroup
                    sortGroup
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The filter-mode group (web Filter icon + All / Stale Only / Active Only).
    private var filterGroup: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ForEach(SignalCatalogPanelFilterMode.allCases, id: \.self) { mode in
                SignalCatalogPanelSegmentButton(
                    title: SignalCatalogPanelStrings.filterLabel(mode),
                    isActive: model.filterMode == mode,
                    activeTone: Color.TS.accent
                ) {
                    model.setFilterMode(mode)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// The sort-mode group (web ArrowUpDown icon + Most Stale / A-Z / Category).
    private var sortGroup: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "arrow.up.arrow.down")
                .font(.system(size: 12))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ForEach(SignalCatalogPanelSortMode.allCases, id: \.self) { mode in
                SignalCatalogPanelSegmentButton(
                    title: SignalCatalogPanelStrings.sortLabel(mode),
                    isActive: model.sortMode == mode,
                    activeTone: Color.TS.chartSeriesPower
                ) {
                    model.setSortMode(mode)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Search field (web search `<Input>` with leading icon + aria-label)

/// The name search field — a leading magnifying-glass icon and the web search
/// prompt + aria-label (web search `<Input>` "Filter by signal name…").
struct SignalCatalogPanelSearchField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $text,
                prompt: Text(verbatim: SignalCatalogPanelStrings.searchPrompt)
            ) {
                Text(verbatim: SignalCatalogPanelStrings.searchAria)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .labelsHidden()
            .autocorrectionDisabled()
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
                .accessibilityLabel(Text(verbatim: SignalCatalogPanelStrings.searchAria))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
        )
        .frame(maxWidth: 420, alignment: .leading)
    }
}

// MARK: - Segment button (web ghost `<Button>` with active tint)

/// One filter / sort segment: a small pill that tints to the group's accent when
/// active, carrying the selected accessibility trait.
struct SignalCatalogPanelSegmentButton: View {
    let title: String
    let isActive: Bool
    let activeTone: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(isActive ? .semibold : .regular)
                .lineLimit(1)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .foregroundStyle(isActive ? activeTone : Color.TS.textMuted)
                .background(
                    Capsule().fill(isActive ? activeTone.opacity(0.12) : Color.clear)
                )
                .overlay(
                    Capsule().strokeBorder(isActive ? activeTone.opacity(0.35) : Color.TS.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}
