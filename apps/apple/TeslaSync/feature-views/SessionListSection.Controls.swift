//
//  SessionListSection.Controls.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The interactive controls composed into the populated content: the search field
//  (web `SearchInput`), the active-filter chips (web `ActiveFilterChips`), the
//  charger filter + sort pill bars (web ghost `Button` pills), and the CSV / JSON
//  export buttons (web `<a download>` links). Token-driven (P1/S9); copy via the
//  P1/S10 facade. The view performs no networking — export hands a request path to
//  the model's exporter seam.
//

import SwiftUI

// MARK: - Search field (web `SearchInput`)

/// The inline search field — a magnifying glass, a bound text field whose web key is
/// the prompt, and a clear button when non-empty. Edits route through
/// `setSearchQuery` so the page resets, matching the web filter behavior.
struct SessionSearchField: View {
    @Bindable var model: SessionListModel

    /// The web prompt copy, isolated so the i18n key (a literal key name from the web
    /// source) stays an explicit, scanner-acknowledged constant rather than a stub.
    private enum SearchCopy {
        static let key = "charging.sessions.searchPlaceholder" // parity:allow web i18n key name, not a stub
        static let fallback = "Search by location or charger type…"
    }

    var body: some View {
        let binding = Binding(get: { model.searchQuery }, set: { model.setSearchQuery($0) })
        let prompt = Text(verbatim: SessionListStrings.string(SearchCopy.key, SearchCopy.fallback))
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField("", text: binding, prompt: prompt)
                .textFieldStyle(.plain)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(SessionListStrings.text(SearchCopy.key, SearchCopy.fallback))
            if !model.searchQuery.isEmpty {
                Button { model.setSearchQuery("") } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(SessionListStrings.text("charging.sessions.clearSearch", "Clear search"))
            }
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

// MARK: - Active-filter chips (web `ActiveFilterChips`)

/// The removable active-filter tokens + a "Clear all" affordance (web
/// `ActiveFilterChips`). Scrolls horizontally so many chips never clip.
struct SessionActiveChips: View {
    let chips: [SessionFilterChip]
    let onRemove: (SessionFilterChip) -> Void
    let onClearAll: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.sm) {
                ForEach(chips) { chip in
                    SessionChipToken(chip: chip) { onRemove(chip) }
                }
                if chips.count > 1 {
                    Button(action: onClearAll) {
                        SessionListStrings.text("charging.sessions.clearAll", "Clear all")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.accent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// One active-filter chip token: "{label}: {value}" with an x button.
struct SessionChipToken: View {
    let chip: SessionFilterChip
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(chip.label): \(chip.value)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(SessionListStrings.text("charging.sessions.removeFilter", "Remove filter"))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 4)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Controls bar (charger filter + sort + export)

/// The header controls: the charger filter + sort pill bars beside the export
/// buttons on a wide layout, stacking vertically when compact (web flex-wrap row).
struct SessionControlsBar: View {
    @Bindable var model: SessionListModel
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var isWide: Bool {
        horizontalSizeClass != .compact
    }

    var body: some View {
        Group {
            if isWide {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    SessionChargerFilterBar(model: model)
                    SessionSortBar(model: model)
                    Spacer(minLength: TSSpacing.sm)
                    SessionExportButtons(model: model)
                }
            } else {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    SessionChargerFilterBar(model: model)
                    SessionSortBar(model: model)
                    SessionExportButtons(model: model)
                }
            }
        }
    }
}

// MARK: - Charger filter bar (web All / Home / SC / DC pills)

/// The charger filter pill bar (web `chargerFilter` ghost buttons).
struct SessionChargerFilterBar: View {
    @Bindable var model: SessionListModel

    var body: some View {
        SessionPillGroup(systemImage: "line.3.horizontal.decrease") {
            ForEach(SessionChargerFilter.pillOrder) { filter in
                SessionPillButton(
                    title: SessionListStrings.string(filter.localizationKey, filter.fallback),
                    isActive: model.chargerFilter == filter
                ) {
                    model.setChargerFilter(filter)
                }
            }
        }
    }
}

// MARK: - Sort bar (web Date / kWh / Cost / Time / Power pills)

/// The sort pill bar (web `sortBy` ghost buttons). The active key shows the
/// direction arrow (web `sortDesc ? '↓' : '↑'`).
struct SessionSortBar: View {
    @Bindable var model: SessionListModel

    var body: some View {
        SessionPillGroup(systemImage: "arrow.up.arrow.down") {
            ForEach(SessionSortKey.allCases) { key in
                SessionPillButton(
                    title: SessionListStrings.string(key.localizationKey, key.fallback),
                    isActive: model.sortKey == key,
                    indicator: model.sortKey == key ? (model.sortDescending ? "↓" : "↑") : nil
                ) {
                    model.selectSort(key)
                }
            }
        }
    }
}

// MARK: - Export buttons (web CSV / JSON download links)

/// The CSV + JSON export buttons (web `<a download>` links). Each builds its request
/// path through the model and hands it to the exporter seam.
struct SessionExportButtons: View {
    @Bindable var model: SessionListModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(SessionListExportFormat.allCases) { format in
                Button { model.export(format) } label: {
                    HStack(spacing: TSSpacing.xs) {
                        Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .semibold))
                        Text(verbatim: SessionListStrings.string(format.localizationKey, format.fallback))
                            .font(Font.TS.caption)
                            .fontWeight(.medium)
                    }
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, TSSpacing.xs)
                    .background(
                        Color.TS.surfaceGlass,
                        in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(exportLabel(for: format))
            }
        }
    }

    private func exportLabel(for format: SessionListExportFormat) -> Text {
        let action = SessionListStrings.string("charging.sessions.exportAction", "Export")
        return Text(verbatim: "\(action) \(SessionListStrings.string(format.localizationKey, format.fallback))")
    }
}

// MARK: - Pill primitives

/// A bordered pill container holding a leading glyph + a row of pill buttons (web
/// `rounded-lg bg-white/[0.02] p-1 border` group).
struct SessionPillGroup<Content: View>: View {
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            content
        }
        .padding(TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// One ghost pill button (web ghost `Button` with the active-state tint). The active
/// button reads as a selected trait for VoiceOver.
struct SessionPillButton: View {
    let title: String
    let isActive: Bool
    var indicator: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 2) {
                Text(verbatim: title)
                if let indicator {
                    Text(verbatim: indicator)
                }
            }
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(isActive ? Color.TS.textPrimary : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 4)
            .background(
                isActive ? Color.TS.surface : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
