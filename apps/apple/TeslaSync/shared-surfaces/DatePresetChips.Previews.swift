//
//  DatePresetChips.Previews.swift
//  TeslaSync — P4 shared surface · 0151 · DatePresetChips (Apple)
//
//  Xcode previews for every branch of the quick-select chip row: the default set, an active highlight, a
//  custom subset at the medium size, the full catalog (wrapping), and the empty state (no matching
//  presets). DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    #Preview("Default set") {
        staged("today · 7d · 30d · mtd · ytd · all") {
            DatePresetChips(onSelect: { _ in })
        }
    }

    #Preview("Active highlight") {
        staged("activeId = 30d") {
            DatePresetChips(activeID: "30d", onSelect: { _ in })
        }
    }

    #Preview("Custom subset · medium") {
        staged("today · yesterday · 7d · 90d · lastMonth") {
            DatePresetChips(
                presetIDs: ["today", "yesterday", "7d", "90d", "lastMonth"],
                activeID: "7d",
                size: .medium,
                onSelect: { _ in }
            )
        }
    }

    #Preview("Full catalog · wraps") {
        staged("every preset · wraps to multiple lines") {
            DatePresetChips(
                presetIDs: DatePresetChipsCatalog.all.map(\.id),
                onSelect: { _ in }
            )
        }
    }

    #Preview("Empty (no matching presets)") {
        staged("presetIds = [] · empty state shown") {
            DatePresetChips(presetIDs: [], onSelect: { _ in })
        }
    }
#endif
