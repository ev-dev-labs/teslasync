//
//  WidgetCatalogueDialog.Rows.swift
//  TeslaSync — P4 modal / dialog · 0026 · WidgetCatalogueDialog (Apple)
//
//  The search header + category section + entry row leaf views `WidgetCataloguePopulatedView` composes
//  (split from the chrome for the lint file-length budget): the subtitle + sticky search field + live
//  result count, the in-catalogue no-matches empty card (web `widget-catalogue-empty`), the per-category
//  section (emoji + localized label + count over its entries), and the per-entry row (icon tile, name +
//  "Added" badge, description, and the Add button). Widget names + descriptions are product copy rendered
//  verbatim; all chrome copy resolves through P1/S10. Binds through `WidgetCatalogueModel` (P1/S8).
//

import SwiftUI

// MARK: - Search header (web subtitle + search input + result count)

/// The subtitle, the search field, and the live result tally (web `space-y-3` header block). Pinned above
/// the scrolling sections.
struct WidgetCatalogueSearchHeader: View {
    @Bindable var model: WidgetCatalogueModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: model.subtitleText)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            WidgetCatalogueSearchField(model: model)
            if model.isFiltering {
                Text(verbatim: model.resultCountText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The search field (web `<Input type="search">`): a magnifying-glass glyph, a bound text field that
/// filters as you type, and a clear button when non-empty. Focuses on appear (web defers focus to the
/// input after the modal mounts).
struct WidgetCatalogueSearchField: View {
    @Bindable var model: WidgetCatalogueModel
    @FocusState private var focused: Bool

    private var text: Binding<String> {
        Binding(get: { model.query }, set: { model.setQuery($0) })
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: text,
                prompt: Text(verbatim: WidgetCatalogueStrings.string(
                    "dashboard.catalogue.searchPlaceholder",
                    "Search widgets by name, description, or category…"
                ))
            ) {
                Text(verbatim: WidgetCatalogueStrings.string("dashboard.catalogue.searchLabel", "Search widgets"))
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .focused($focused)
            .submitLabel(.search)
            #if os(iOS)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
            #endif
                .accessibilityLabel(Text(verbatim: WidgetCatalogueStrings.string(
                    "dashboard.catalogue.searchLabel", "Search widgets"
                )))
            if !model.query.isEmpty {
                Button(action: model.clearSearch) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(Color.TS.textMuted)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: WidgetCatalogueStrings.string(
                    "dashboard.catalogue.clearSearch", "Clear search"
                )))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass.opacity(0.5),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(focused ? Color.TS.accent : Color.TS.border, lineWidth: 1)
        )
        .onAppear { focused = true }
    }
}

// MARK: - Search-empty card (web `widget-catalogue-empty`)

/// The in-catalogue no-matches state (web `isFiltering && visibleCount === 0`): a title, a body pointing
/// at the full catalogue size, and a Clear-search action. Never a blank box.
struct WidgetCatalogueSearchEmptyCard: View {
    @Bindable var model: WidgetCatalogueModel

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: WidgetCatalogueStrings.string(
                "dashboard.catalogue.emptyTitle", "No widgets match your search"
            ))
            .font(Font.TS.body)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            Text(verbatim: model.searchEmptyBodyText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            TSButton(variant: .ghost, size: .small, action: model.clearSearch) {
                Text(verbatim: WidgetCatalogueStrings.string("dashboard.catalogue.clearSearch", "Clear search"))
            }
            .padding(.top, TSSpacing.xs)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Category section (web `<section>` per category)

/// One category section (web `filteredEntries.map`): the emoji + localized label + entry count header
/// over the category's entry rows.
struct WidgetCatalogueCategorySection: View {
    @Bindable var model: WidgetCatalogueModel
    let group: WidgetCatalogueGroup
    let onAdd: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            VStack(spacing: TSSpacing.sm) {
                ForEach(group.entries) { entry in
                    WidgetCatalogueEntryRow(model: model, entry: entry, onAdd: onAdd)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: group.category.emoji)
                .font(Font.TS.caption)
                .accessibilityHidden(true)
            Text(verbatim: model.categoryLabel(group.category).uppercased())
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textMuted)
                .tracking(0.6)
            Text(verbatim: "(\(group.entries.count))")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: "\(model.categoryLabel(group.category)), \(group.entries.count)"))
    }
}

// MARK: - Entry row (web widget `<div>` card)

/// One catalogue row (web `widgets.map` card): the icon tile, the widget name + an "Added" badge when on
/// the layout, the description, and the Add button (disabled + reading "Added" when already added).
struct WidgetCatalogueEntryRow: View {
    @Bindable var model: WidgetCatalogueModel
    let entry: WidgetCatalogueEntry
    let onAdd: (String) -> Void

    private var isAdded: Bool {
        model.isAdded(entry.id)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconTile
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: entry.name)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    if isAdded {
                        WidgetCatalogueAddedBadge()
                    }
                }
                Text(verbatim: entry.description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            addButton
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(entry)))
    }

    private var iconTile: some View {
        Image(systemName: entry.iconSystemName)
            .font(.system(size: 15, weight: .regular))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 34, height: 34)
            .background(
                Color.TS.surfaceGlass.opacity(0.6),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var addButton: some View {
        TSButton(variant: .ghost, size: .small, action: triggerAdd) {
            Text(verbatim: isAdded
                ? WidgetCatalogueStrings.string("dashboard.added", "Added")
                : WidgetCatalogueStrings.string("dashboard.catalogue.add", "Add"))
        }
        .disabled(isAdded)
        .opacity(isAdded ? 0.5 : 1)
        .accessibilityLabel(Text(verbatim: model.addAccessibilityLabel(entry)))
    }

    private func triggerAdd() {
        onAdd(entry.id)
    }
}

// MARK: - Added badge (web `<Badge variant="neutral">Added</Badge>`)

/// The neutral "Added" badge next to an already-added widget's name.
struct WidgetCatalogueAddedBadge: View {
    var body: some View {
        Text(verbatim: WidgetCatalogueStrings.string("dashboard.added", "Added"))
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surfaceGlass.opacity(0.7), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityHidden(true)
    }
}
