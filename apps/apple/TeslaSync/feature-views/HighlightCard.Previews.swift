//
//  HighlightCard.Previews.swift
//  TeslaSync — P4 feature view · 0076 · HighlightCard (Apple)
//
//  Xcode previews for each branch the web source carries: the five colour
//  accents, the up / down trend chip, the subtitle variant, and the em-dash
//  empty value. DEBUG-only; skipped by the release host gate.
//

import SwiftUI

#if DEBUG
    /// A silent telemetry sink so previews don't emit `view.opened` noise.
    private struct SilentHighlightCardTelemetry: HighlightCardTelemetry {
        func viewOpened(surface _: String) {}
    }

    private extension HighlightCard {
        /// Preview convenience: builds a card with the silent telemetry sink.
        static func preview(
            systemImage: String,
            label: LocalizedStringKey,
            value: String,
            change: HighlightCardChange? = nil,
            subtitle: LocalizedStringKey? = nil,
            accent: HighlightCardAccent
        ) -> HighlightCard {
            HighlightCard(
                systemImage: systemImage,
                label: label,
                value: value,
                change: change,
                subtitle: subtitle,
                accent: accent,
                telemetry: SilentHighlightCardTelemetry()
            )
        }
    }

    private let previewColumns = [
        GridItem(.adaptive(minimum: 200), spacing: TSSpacing.lg)
    ]

    #Preview("Accents · trends") {
        ScrollView {
            LazyVGrid(columns: previewColumns, spacing: TSSpacing.lg) {
                HighlightCard.preview(
                    systemImage: "car.fill",
                    label: "Total Distance",
                    value: "342.8 km",
                    change: HighlightCardChange(value: "+12.4%", isPositive: true),
                    accent: .cyan
                )
                HighlightCard.preview(
                    systemImage: "bolt.fill",
                    label: "Total Drives",
                    value: "27",
                    change: HighlightCardChange(value: "+4.1%", isPositive: true),
                    accent: .green
                )
                HighlightCard.preview(
                    systemImage: "powerplug.fill",
                    label: "Energy Used",
                    value: "118.6 kWh",
                    change: HighlightCardChange(value: "-3.2%", isPositive: false),
                    accent: .purple
                )
                HighlightCard.preview(
                    systemImage: "fuelpump.fill",
                    label: "Charging Cost",
                    value: "$45.67",
                    change: HighlightCardChange(value: "+8.0%", isPositive: false),
                    accent: .amber
                )
                HighlightCard.preview(
                    systemImage: "leaf.fill",
                    label: "CO₂ Saved",
                    value: "82.1 kg",
                    change: HighlightCardChange(value: "+6.5%", isPositive: true),
                    accent: .red
                )
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Subtitle · no change") {
        HighlightCard.preview(
            systemImage: "mappin.and.ellipse",
            label: "Fun Fact",
            value: "8×",
            subtitle: "≈ 8× San Francisco → Los Angeles",
            accent: .cyan
        )
        .frame(width: 280)
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Empty value") {
        HighlightCard.preview(
            systemImage: "car.fill",
            label: "Total Distance",
            value: "",
            accent: .cyan
        )
        .frame(width: 280)
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
    }

    #Preview("Dark") {
        HighlightCard.preview(
            systemImage: "powerplug.fill",
            label: "Energy Used",
            value: "118.6 kWh",
            change: HighlightCardChange(value: "-3.2%", isPositive: false),
            subtitle: "vs. previous week",
            accent: .purple
        )
        .frame(width: 280)
        .padding(TSSpacing.lg)
        .background(Color.TS.bg)
        .preferredColorScheme(.dark)
    }
#endif
