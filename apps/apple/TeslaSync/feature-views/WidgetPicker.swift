//
//  WidgetPicker.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  The dashboard "Add Widget" picker — the SwiftUI parity of
//  features/dashboard/components/WidgetPicker.tsx. Renders the web Drawer chrome
//  (titled header + close, scrolling body, conditional "added" footer) over the
//  full browse experience: a sticky search field with a live result count, the
//  category filter chips, the persisted "Recently Added" row, the "Layout
//  Presets", and the widgets themselves — grouped by category when browsing or a
//  flat result list (with an "Add all") when searching, falling back to a
//  friendly no-results state. State + persistence live in `WidgetPickerModel`;
//  the host receives added ids / chosen preset / close through its callbacks. No
//  networking lives here — the catalog is static, exactly like the web registry.
//

import SwiftUI

/// The WidgetPicker surface (web `WidgetPicker`). State lives in
/// `WidgetPickerModel`; the host supplies the active widgets and the
/// add/apply-preset/close callbacks.
public struct WidgetPicker: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetPickerSurface.slug

    @State private var model: WidgetPickerModel
    @FocusState private var searchFocused: Bool

    public init(model: WidgetPickerModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            WidgetHairline()
            ScrollView {
                content
                    .padding(TSSpacing.lg)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if model.addedThisSessionCount > 0 {
                WidgetAddedFooter(countText: model.addedCountText) { model.requestClose() }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.TS.surface)
        .task { await onFirstAppear() }
        .onChange(of: model.announcement) { _, message in announce(message) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(WidgetPickerStrings.text("dashboard.addWidget", "Add Widget"))
    }

    // MARK: - Chrome

    private var header: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: WidgetPickerStrings.string("dashboard.addWidget", "Add Widget"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button { model.requestClose() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(TSSpacing.xs)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WidgetPickerStrings.text("a11y.close", "Close"))
        }
        .padding(TSSpacing.lg)
    }

    // MARK: - Body content

    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            searchSection
            WidgetCategoryFilterBar(
                categories: model.availableCategories,
                selection: model.categoryFilter
            ) { model.selectCategory($0) }
            if !model.recentlyAddedVisible.isEmpty {
                recentlyAddedSection
            }
            if model.query.isEmpty, model.categoryFilter == nil {
                presetsSection
            }
            widgetsSection
        }
    }

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WidgetPickerSearchField(
                text: searchBinding,
                focused: $searchFocused,
                onSubmit: { model.submitSearch() },
                onClear: { model.clearSearch() }
            )
            Text(verbatim: model.availableText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var recentlyAddedSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            WidgetSectionHeader(
                title: WidgetPickerStrings.string("widgets.recentlyAdded", "Recently Added"),
                systemImage: "clock"
            )
            ForEach(model.recentlyAddedVisible) { entry in
                card(for: entry)
            }
            WidgetHairline()
        }
    }

    private var presetsSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            WidgetSectionHeader(title: WidgetPickerStrings.string("dashboard.presets", "Layout Presets"))
            ForEach(WidgetCatalog.presets) { preset in
                WidgetPresetCard(preset: preset) { model.applyPreset(preset.id) }
            }
            WidgetHairline()
        }
    }

    @ViewBuilder
    private var widgetsSection: some View {
        if model.query.isEmpty {
            groupedSection
        } else {
            searchResultsSection
        }
    }

    private var groupedSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(model.groupedEntries) { group in
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    WidgetCategorySectionHeader(
                        title: group.category.label,
                        addableCount: model.addable(in: group.entries).count
                    ) {
                        model.addMany(model.addable(in: group.entries).map(\.id))
                    }
                    ForEach(group.entries) { entry in
                        card(for: entry)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var searchResultsSection: some View {
        let results = model.filteredWidgets
        if results.isEmpty {
            WidgetNoResultsView(query: model.trimmedSearch)
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if results.count > 1 {
                    WidgetSearchResultsBar(
                        resultCount: results.count,
                        query: model.trimmedSearch,
                        addableCount: model.addableSearchWidgets.count
                    ) {
                        model.addMany(model.addableSearchWidgets.map(\.id))
                    }
                }
                ForEach(results) { entry in
                    card(for: entry)
                }
            }
        }
    }

    private func card(for entry: WidgetCatalogEntry) -> some View {
        WidgetCard(
            entry: entry,
            isAdded: model.isAdded(entry),
            query: model.query
        ) {
            model.add(entry)
        }
    }

    // MARK: - Plumbing

    private var searchBinding: Binding<String> {
        Binding(get: { model.search }, set: { model.search = $0 })
    }

    private func onFirstAppear() async {
        model.start()
        try? await Task.sleep(for: .milliseconds(120))
        searchFocused = true
    }

    private func announce(_ message: String) {
        guard !message.isEmpty else { return }
        AccessibilityNotification.Announcement(message).post()
    }
}
