//
//  WidgetTipCards.Previews.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  Xcode previews for every real branch of the tip cards: the populated list across mixed impacts
//  (high/medium/low badges) with leading glyphs, a no-impact / no-glyph variant, the `compact` single-tip
//  slice with its two-line clamp, and the empty leaf. DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
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
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleTips() -> [TipItem] {
        [
            TipItem(
                id: "precondition",
                iconSymbol: "thermometer.sun",
                title: "Precondition on shore power",
                description: "Warm the cabin while still plugged in to save roughly 6% of range on cold mornings.",
                impact: .high,
                impactLabel: "High"
            ),
            TipItem(
                id: "tire-pressure",
                iconSymbol: "gauge.with.dots.needle.bottom.50percent",
                title: "Check tire pressure",
                description: "Two tires are 3 psi low — topping them up improves efficiency and tire life.",
                impact: .medium
            ),
            TipItem(
                id: "charge-limit",
                iconSymbol: "battery.75percent",
                title: "Lower daily charge limit",
                description: "Charging to 80% instead of 90% for daily use slows long-term degradation.",
                impact: .low
            )
        ]
    }

    #Preview("Populated — mixed impacts") {
        staged("three tips · high/medium/low badges · leading glyphs") {
            WidgetTipCards(tips: sampleTips())
                .frame(height: 220)
        }
    }

    #Preview("No impact / no glyph") {
        staged("plain tips · no badge · no leading glyph") {
            WidgetTipCards(
                tips: [
                    TipItem(
                        id: "plan-trip",
                        title: "Plan your road trip",
                        description: "Add stops in the trip planner to see charging time built into your route."
                    ),
                    TipItem(
                        id: "sentry",
                        title: "Sentry Mode drains range",
                        description: "Leaving Sentry on overnight can use several percent of battery."
                    )
                ]
            )
            .frame(height: 180)
        }
    }

    #Preview("Compact — single tip, clamped") {
        staged("compact · one tip · description clamps to two lines") {
            WidgetTipCards(tips: sampleTips(), compact: true)
                .frame(height: 120)
        }
    }

    #Preview("Empty — nothing to recommend") {
        staged("no tips · friendly empty leaf · never a blank box") {
            WidgetTipCards(tips: [])
                .frame(height: 180)
        }
    }
#endif
