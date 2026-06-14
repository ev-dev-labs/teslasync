//
//  WidgetRankedList.Previews.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  Xcode previews for every state of the ranked list: the full list with magnitude bars + badges, the
//  compact variant (capped at 3, bars hidden), the bars-off variant, custom bar tones, the all-zero edge
//  (flat bars), a single item, the loading skeleton, the error tile, the empty leaf, and the stale /
//  offline freshness chips. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
//  scope.
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
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleItems() -> [RankedItem] {
        [
            RankedItem(
                id: "1",
                label: "Home",
                value: 412,
                formattedValue: "412 kWh",
                badge: RankedBadge(text: "Top", tone: .success),
                barTone: .success
            ),
            RankedItem(
                id: "2",
                label: "Supercharger — Market St",
                value: 286,
                formattedValue: "286 kWh",
                barTone: .accent
            ),
            RankedItem(
                id: "3",
                label: "Work",
                value: 174,
                formattedValue: "174 kWh",
                badge: RankedBadge(text: "Slow", tone: .warning),
                barTone: .warning
            ),
            RankedItem(id: "4", label: "Destination — Tahoe", value: 98, formattedValue: "98 kWh", barTone: .info),
            RankedItem(
                id: "5",
                label: "Street — 2nd Ave",
                value: 41,
                formattedValue: "41 kWh",
                badge: RankedBadge(text: "Rare", tone: .neutral),
                barTone: .neutral
            ),
            RankedItem(id: "6", label: "Overflow (sliced)", value: 12, formattedValue: "12 kWh")
        ]
    }

    #Preview("List — bars + badges (top 5)") {
        staged("six items · sorted desc · capped at 5 · bars + badges") {
            WidgetRankedList(items: sampleItems())
        }
    }

    #Preview("Compact — capped at 3, bars hidden") {
        staged("compact · maxItems defaults to 3 · bars hidden") {
            WidgetRankedList(items: sampleItems(), compact: true)
        }
    }

    #Preview("Bars off — showBars false") {
        staged("showBars: false · no magnitude bars") {
            WidgetRankedList(items: sampleItems(), showBars: false)
        }
    }

    #Preview("All-zero values — flat bars") {
        staged("every value 0 · maxValue 0 · barFraction 0") {
            WidgetRankedList(
                items: [
                    RankedItem(id: "a", label: "Alpha", value: 0, formattedValue: "0 kWh"),
                    RankedItem(id: "b", label: "Bravo", value: 0, formattedValue: "0 kWh"),
                    RankedItem(id: "c", label: "Charlie", value: 0, formattedValue: "0 kWh")
                ]
            )
        }
    }

    #Preview("Single item") {
        staged("one item · full-width bar") {
            WidgetRankedList(
                items: [
                    RankedItem(
                        id: "solo",
                        label: "Only stop",
                        value: 320,
                        formattedValue: "320 kWh",
                        badge: RankedBadge(text: "Best", tone: .success),
                        barTone: .success
                    )
                ]
            )
        }
    }

    #Preview("Loading — skeleton rows") {
        staged("host query resolving · skeleton ranked rows") {
            WidgetRankedList(items: [], isLoading: true)
        }
    }

    #Preview("Error — retryable tile") {
        staged("data failed · QueryError peer + retry") {
            WidgetRankedList(items: [], errorMessage: "The request timed out.")
        }
    }

    #Preview("Empty — nothing to show") {
        staged("no items · friendly empty leaf · never a blank box") {
            WidgetRankedList(items: [])
        }
    }

    #Preview("Stale — freshness chip") {
        staged("stale data · freshness chip + one-shot auto-refresh") {
            WidgetRankedList(items: sampleItems(), maxItems: 3, connection: .stale)
        }
    }

    #Preview("Offline — cached items") {
        staged("offline · cached items + offline chip") {
            WidgetRankedList(items: sampleItems(), maxItems: 3, connection: .offline)
        }
    }
#endif
