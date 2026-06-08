//
//  WidgetPicker.Views.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  The composable SwiftUI pieces of the WidgetPicker drawer — the parity of the
//  web `WidgetPicker.tsx` render tree, split out so the top-level `WidgetPicker`
//  view stays declarative. Each piece maps to a web fragment: the sticky search
//  field, the category filter chips (web role="tablist"), the section headers
//  (Recently Added / Layout Presets / per-category), the widget card
//  (`renderWidgetCard`), the preset card, the "Add all" affordances, the
//  no-results empty state, and the session "added" footer. All copy resolves
//  through `WidgetPickerStrings`; tokens come from the generated design system.
//

import SwiftUI

// MARK: - Highlighted text (web highlightMatch)

/// Concatenates `WidgetPickerAdapter.highlight` segments into a single `Text`,
/// accenting + emboldening the matched run (web `<span class="text-primary
/// font-semibold">`).
func widgetHighlightedText(
    _ segments: [WidgetTextSegment],
    font: Font,
    baseColor: Color,
    matchColor: Color = Color.TS.accent
) -> Text {
    segments.reduce(Text(verbatim: "")) { acc, segment in
        let run = Text(verbatim: segment.text)
            .font(font)
            .fontWeight(segment.isMatch ? .semibold : .regular)
            .foregroundColor(segment.isMatch ? matchColor : baseColor)
        return acc + run
    }
}

// MARK: - Shared chrome

/// The subtle card surface shared by widget + preset cards (web
/// `bg-white/[0.03] border-white/[0.06] rounded-xl`).
private struct WidgetCardChrome: ViewModifier {
    var isDisabled = false

    func body(content: Content) -> some View {
        content
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .opacity(isDisabled ? 0.4 : 1)
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }
}

extension View {
    func widgetCardChrome(isDisabled: Bool = false) -> some View {
        modifier(WidgetCardChrome(isDisabled: isDisabled))
    }
}

/// A hairline separator (web `h-px bg-white/[0.06]`).
struct WidgetHairline: View {
    var body: some View {
        Rectangle()
            .fill(Color.TS.border)
            .frame(height: 1)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }
}

/// The "Added" chip on an already-placed widget (web `Badge variant="neutral"`).
struct WidgetAddedBadge: View {
    var body: some View {
        WidgetPickerStrings.text("dashboard.added", "Added")
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.textMuted.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.textMuted.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}

// MARK: - Search field (web sticky Input)

/// The sticky search field (web `Input` with a leading search glyph). Auto-focus
/// is owned by the host view; Return adds a lone result and Escape clears a
/// non-empty query (web `handleKeyDown`).
struct WidgetPickerSearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $text,
                prompt: Text(verbatim: WidgetPickerStrings.string(
                    "widgets.search",
                    "Search widgets... (e.g. battery, chart, map)"
                ))
            ) {
                WidgetPickerStrings.text("widgets.search", "Search widgets... (e.g. battery, chart, map)")
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .focused(focused)
            .submitLabel(.search)
            .autocorrectionDisabled(true)
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
                .onSubmit(onSubmit)
            if !text.isEmpty {
                Button(action: onClear) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(WidgetPickerStrings.text("widgets.clearSearch", "Clear search"))
            }
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onKeyPress(.escape) {
            guard !text.isEmpty else { return .ignored }
            onClear()
            return .handled
        }
    }
}

// MARK: - Category filter chips (web role="tablist")

/// The horizontally scrolling category filter chips (web filter pills). `nil`
/// selection is the leading "All" chip.
struct WidgetCategoryFilterBar: View {
    let categories: [WidgetCatalogCategory]
    let selection: WidgetCatalogCategory?
    let onSelect: (WidgetCatalogCategory?) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.xs) {
                WidgetCategoryPill(
                    title: WidgetPickerStrings.string("widgets.allCategories", "All"),
                    isSelected: selection == nil,
                    action: { onSelect(nil) }
                )
                ForEach(categories) { category in
                    WidgetCategoryPill(
                        title: category.label,
                        isSelected: selection == category,
                        action: { onSelect(category) }
                    )
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(WidgetPickerStrings.text("widgets.categoryFilter", "Filter by category"))
    }
}

/// One filter chip (web category pill).
struct WidgetCategoryPill: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(verbatim: title)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.md)
                .frame(height: 28)
                .background(
                    isSelected ? Color.TS.accent.opacity(0.15) : Color.TS.surfaceGlass,
                    in: Capsule()
                )
                .overlay(
                    Capsule().strokeBorder(
                        isSelected ? Color.TS.accent.opacity(0.4) : Color.TS.border,
                        lineWidth: 1
                    )
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Section header

/// An uppercase section header with an optional leading glyph (web
/// `text-xs font-semibold uppercase tracking-wider text-muted`).
struct WidgetSectionHeader: View {
    let title: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: title.uppercased())
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

/// A per-category header row with a trailing "Add all" affordance (web grouped
/// section header).
struct WidgetCategorySectionHeader: View {
    let title: String
    let addableCount: Int
    let onAddAll: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            WidgetSectionHeader(title: title)
            Spacer(minLength: 0)
            WidgetAddAllButton(count: addableCount, action: onAddAll)
        }
    }
}

/// The ghost "+ Add all {count}" button (disabled when nothing is addable).
struct WidgetAddAllButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: action) {
            Text(verbatim: WidgetPickerAdapter.addAllText(count: count, localize: WidgetPickerStrings.localize))
                .font(Font.TS.caption)
        }
        .disabled(count < 1)
        .accessibilityLabel(
            Text(verbatim: WidgetPickerAdapter.addAllText(count: count, localize: WidgetPickerStrings.localize))
        )
    }
}

// MARK: - Search results bar (web "{count} results for …")

/// The search summary bar shown above multi-result searches: the result count
/// and an "Add all" affordance (web results header).
struct WidgetSearchResultsBar: View {
    let resultCount: Int
    let query: String
    let addableCount: Int
    let onAddAll: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Text(verbatim: WidgetPickerAdapter.searchResultsText(
                count: resultCount,
                query: query,
                localize: WidgetPickerStrings.localize
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
            WidgetAddAllButton(count: addableCount, action: onAddAll)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}
