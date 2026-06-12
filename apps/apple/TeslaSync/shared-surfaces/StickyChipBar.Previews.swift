//
//  StickyChipBar.Previews.swift
//  TeslaSync — P4 shared surface · 0200 · StickyChipBar (Apple)
//
//  Xcode previews for every branch of the in-page section nav: a few inline chips (first active), a long
//  scrolling set, a seeded non-first active (injected model), long-label truncation, the `topOffset`
//  inset, and the empty set (friendly empty view). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 480, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleChips(_ count: Int) -> [SectionChip] {
        let pool = [
            SectionChip(id: "overview", label: "Overview"),
            SectionChip(id: "battery", label: "Battery"),
            SectionChip(id: "charging", label: "Charging"),
            SectionChip(id: "drives", label: "Drives"),
            SectionChip(id: "efficiency", label: "Efficiency"),
            SectionChip(id: "climate", label: "Climate"),
            SectionChip(id: "tires", label: "Tire pressure"),
            SectionChip(id: "software", label: "Software"),
            SectionChip(id: "location", label: "Location")
        ]
        return Array(pool.prefix(count))
    }

    #Preview("Inline chips · first active") {
        staged("4 sections · Overview active") {
            StickyChipBar(chips: sampleChips(4))
        }
    }

    #Preview("Scrolling set") {
        staged("9 sections · horizontal scroll") {
            StickyChipBar(chips: sampleChips(9), onSelect: { _ in })
        }
    }

    #Preview("Seeded active (Charging)") {
        staged("injected model · Charging active") {
            StickyChipBar(model: StickyChipBarModel(
                input: StickyChipBarInput(chips: sampleChips(6)),
                initialActiveID: "charging"
            ))
        }
    }

    #Preview("Long label truncation") {
        staged("single long section name") {
            StickyChipBar(chips: [
                SectionChip(id: "regen", label: "Regenerative braking energy recovery over the last 7 days")
            ])
        }
    }

    #Preview("With top offset") {
        staged("topOffset 24 · cleared header") {
            StickyChipBar(chips: sampleChips(5), topOffset: 24)
        }
    }

    #Preview("Empty set") {
        staged("no sections · empty view shown") {
            StickyChipBar(chips: [])
        }
    }
#endif
