//
//  NotionSidebar.Previews.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  Xcode previews for every real branch of the sidebar: the full default tree (Favorites + active row +
//  badges), the filtered tree (force-expanded sections), the empty-filter branch, the no-data empty state,
//  and the individual pieces (nav rows active/inactive, the section row expanded/collapsed, the group labels,
//  the trailing badge variants). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import SwiftUI

#if DEBUG

    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
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

    #Preview("Default · favorites + active + badges") {
        NotionSidebar(model: NotionSidebarSampleData.model())
            .frame(width: 260, height: 520)
    }

    #Preview("Filtered · 'char'") {
        NotionSidebar(model: NotionSidebarSampleData.model(filter: "char"))
            .frame(width: 260, height: 520)
    }

    #Preview("Empty filter · 'zzz'") {
        NotionSidebar(model: NotionSidebarSampleData.model(filter: "zzz"))
            .frame(width: 260, height: 520)
    }

    #Preview("No data · friendly empty") {
        NotionSidebar(
            model: NotionSidebarModel(
                input: NotionSidebarSampleData.emptyInput,
                localize: { _, fallback in fallback }
            )
        )
        .frame(width: 260, height: 520)
    }

    #Preview("Inspector · all branches") {
        NotionSidebarInspector()
    }

    #Preview("Rows · active + inactive + pin/unpin") {
        staged("nav rows · quiet active fill, glyph, trailing badge, pin/unpin") {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(rowSamples, id: \.id) { row in
                    NotionSidebarNavRow(row: row, onSelect: {}, onPinToggle: {})
                }
            }
            .frame(width: 240)
        }
    }

    #Preview("Section row + group labels") {
        staged("section row · caret + glyph + count; group labels · sentence case") {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                NotionSidebarGroupLabel(label: "Favorites")
                NotionSidebarSectionRow(
                    title: "Vehicle",
                    glyphSystemImage: "car.2",
                    count: 3,
                    isExpanded: true,
                    onToggle: {}
                )
                NotionSidebarSectionRow(
                    title: "Operations",
                    glyphSystemImage: "bell",
                    count: 2,
                    isExpanded: false,
                    onToggle: {}
                )
            }
            .frame(width: 240)
        }
    }

    #Preview("Trailing badges · dot + chips") {
        staged("trailing · notification dot, vehicle chip, stale chip, 99+ cap") {
            HStack(spacing: TSSpacing.lg) {
                NotionSidebarTrailingBadge(trailing: .notificationDot)
                NotionSidebarTrailingBadge(trailing: .count(text: "5", accessibilityLabel: "5 vehicles"))
                NotionSidebarTrailingBadge(trailing: .count(text: "99+", accessibilityLabel: "120 stale rows"))
            }
        }
    }

    /// A representative row set: active (Vehicles, with a vehicle chip + unpin? no — pin), inactive (Charging,
    /// already pinned → unpin), and a Favorites row (Dashboard, unpin action).
    @MainActor private var rowSamples: [NotionSidebarRow] {
        let presentation = NotionSidebarSampleData.model().presentation
        let section = presentation.sections.first { $0.id == "vehicle" }
        let favorite = presentation.favorites?.rows.first
        return [section?.rows.first, section?.rows.dropFirst().first, favorite].compactMap(\.self)
    }
#endif
