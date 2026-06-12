//
//  LinearSidebar.Previews.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  Xcode previews for every real branch of the sidebar: the full default tree (Favorites + active row +
//  badges), the filtered tree (force-expanded sections), the empty-filter branch, the no-data empty state,
//  and the individual pieces (nav rows active/inactive, the section header expanded/collapsed, the trailing
//  badge variants). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let previewLocalize: LinearSidebarLocalize = { _, fallback in fallback }

    #Preview("Default · favorites + active + badges") {
        LinearSidebar(model: LinearSidebarSampleData.model())
            .frame(width: 260, height: 520)
    }

    #Preview("Filtered · 'char'") {
        LinearSidebar(model: LinearSidebarSampleData.model(filter: "char"))
            .frame(width: 260, height: 520)
    }

    #Preview("Empty filter · 'zzz'") {
        LinearSidebar(model: LinearSidebarSampleData.model(filter: "zzz"))
            .frame(width: 260, height: 520)
    }

    #Preview("No data · friendly empty") {
        LinearSidebar(
            model: LinearSidebarModel(input: LinearSidebarSampleData.emptyInput, localize: previewLocalize)
        )
        .frame(width: 260, height: 520)
    }

    #Preview("Inspector · all branches") {
        LinearSidebarInspector()
    }

    #Preview("Rows · active + inactive + badges") {
        staged("nav rows · accent bar, glyph, trailing badge, pin/unpin") {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(rowSamples, id: \.id) { row in
                    LinearSidebarNavRow(row: row, onSelect: {}, onPinToggle: {})
                }
            }
            .frame(width: 240)
        }
    }

    #Preview("Section header · expanded + collapsed") {
        staged("section header · chevron + count") {
            VStack(spacing: TSSpacing.xs) {
                LinearSidebarSectionHeader(title: "Vehicle", count: 3, isExpanded: true, onToggle: {})
                LinearSidebarSectionHeader(title: "Operations", count: 2, isExpanded: false, onToggle: {})
                LinearSidebarFavoritesHeader(label: "Favorites")
            }
            .frame(width: 240)
        }
    }

    #Preview("Trailing badges · dot + chips") {
        staged("trailing · notification dot, vehicle chip, stale chip, 99+ cap") {
            HStack(spacing: TSSpacing.lg) {
                LinearSidebarTrailingBadge(trailing: .notificationDot)
                LinearSidebarTrailingBadge(trailing: .count(text: "5", accessibilityLabel: "5 vehicles"))
                LinearSidebarTrailingBadge(trailing: .count(text: "99+", accessibilityLabel: "120 stale rows"))
            }
        }
    }

    /// A representative row set: active (Vehicles, with a vehicle chip), inactive (Charging, pin action),
    /// and a Favorites row (Dashboard, unpin action).
    @MainActor private var rowSamples: [LinearSidebarRow] {
        let presentation = LinearSidebarSampleData.model().presentation
        let section = presentation.sections.first { $0.id == "vehicle" }
        let favorite = presentation.favorites?.rows.first
        return [section?.rows.first, section?.rows.dropFirst().first, favorite].compactMap(\.self)
    }
#endif
