//
//  WidgetPicker.Cards.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  The card-shaped pieces of the WidgetPicker browse list, split out of
//  WidgetPicker.Views.swift to keep each file focused: the widget card
//  (web `renderWidgetCard`), the layout-preset card, the no-results empty state
//  (web `noResults`), and the session "added" footer (web Drawer `footer`). They
//  share the card chrome, highlight helper, and "Added" badge defined alongside
//  the other primitives in WidgetPicker.Views.swift.
//

import SwiftUI

// MARK: - Widget card (web renderWidgetCard)

/// One browsable widget card: icon box, highlighted name + "Added" chip,
/// highlighted description, and the grid-size / category footer. Disabled when
/// the widget is already on the dashboard (web `isAdded`).
struct WidgetCard: View {
    let entry: WidgetCatalogEntry
    let isAdded: Bool
    let query: String
    let onAdd: () -> Void

    var body: some View {
        Button(action: onAdd) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: entry.iconSystemName, tone: .accent)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack(spacing: TSSpacing.sm) {
                        widgetHighlightedText(
                            WidgetPickerAdapter.highlight(entry.name, query: query),
                            font: Font.TS.body,
                            baseColor: Color.TS.textPrimary
                        )
                        .fontWeight(.medium)
                        if isAdded { WidgetAddedBadge() }
                    }
                    widgetHighlightedText(
                        WidgetPickerAdapter.highlight(entry.summary, query: query),
                        font: Font.TS.caption,
                        baseColor: Color.TS.textMuted
                    )
                    .fixedSize(horizontal: false, vertical: true)
                    footer
                }
                Spacer(minLength: 0)
            }
            .widgetCardChrome(isDisabled: isAdded)
        }
        .buttonStyle(.plain)
        .disabled(isAdded)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WidgetPickerAccessibility.cardLabel(
            for: entry,
            isAdded: isAdded,
            localize: WidgetPickerStrings.localize
        )))
        .accessibilityAddTraits(.isButton)
    }

    private var footer: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: "\(entry.defaultSize.cols)×\(entry.defaultSize.rows) "
                + WidgetPickerStrings.string("widgets.gridLabel", "grid"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !query.isEmpty {
                Text(verbatim: entry.category.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }
}

// MARK: - Preset card (web preset button)

/// One layout preset card: the preset name and its widget count (web preset
/// button). Applying it seeds the dashboard and closes the picker.
struct WidgetPresetCard: View {
    let preset: WidgetLayoutPreset
    let onApply: () -> Void

    var body: some View {
        Button(action: onApply) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: preset.name)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: WidgetPickerAdapter.presetWidgetsText(
                    count: preset.widgetCount,
                    localize: WidgetPickerStrings.localize
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
            .widgetCardChrome()
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WidgetPickerAccessibility.presetLabel(
            for: preset,
            localize: WidgetPickerStrings.localize
        )))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - No results (web noResults)

/// The centered empty state when a search matches nothing (web "No widgets
/// match …"). Never a blank box.
struct WidgetNoResultsView: View {
    let query: String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: WidgetPickerAdapter.noResultsText(query: query, localize: WidgetPickerStrings.localize))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x3xl)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Footer (web Drawer footer)

/// The session "added" footer (web Drawer `footer`): a confirmation count and a
/// Done button. Shown only after at least one widget is added this session.
struct WidgetAddedFooter: View {
    let countText: String
    let onDone: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "checkmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                Text(verbatim: countText)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Spacer(minLength: 0)
            TSButton(size: .small, action: onDone) {
                WidgetPickerStrings.text("dashboard.done", "Done")
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface)
        .overlay(alignment: .top) { WidgetHairline() }
    }
}
