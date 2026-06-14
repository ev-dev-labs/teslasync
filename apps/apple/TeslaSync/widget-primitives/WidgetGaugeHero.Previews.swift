//
//  WidgetGaugeHero.Previews.swift
//  TeslaSync — P4 widget primitive · 0007 · WidgetGaugeHero (Apple)
//
//  Xcode previews for every real branch of the gauge hero: the standard gauge with a supporting stats row
//  and an accessory slot, the standard gauge with stats but no accessory, the gauge on its own (no stats),
//  the condensed `compact` variant, an integer reading (0 decimals) vs a fractional reading (precision
//  decimals), the tint range, and the edge configs (value above `max` clamps to full; a zero reading; a
//  `max <= 0` config that guards to an empty arc instead of a NaN fill). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
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
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleStats() -> [GaugeHeroStat] {
        [
            GaugeHeroStat(label: "Range", value: "284", unit: "km"),
            GaugeHeroStat(label: "Added", value: "+62", unit: "km"),
            GaugeHeroStat(label: "Rate", value: "11", unit: "kW")
        ]
    }

    #Preview("Standard — stats + accessory") {
        staged("battery gauge · 74% · three stats · accessory footnote") {
            WidgetGaugeHero(
                gauge: GaugeHeroConfig(value: 74, max: 100, label: "State of charge", unit: "%", tint: .battery),
                stats: sampleStats(),
                locale: Locale(identifier: "en_US")
            ) {
                Text(verbatim: "Updated just now")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    #Preview("Standard — stats, no accessory") {
        staged("energy gauge · fractional reading · stats · no accessory") {
            WidgetGaugeHero(
                gauge: GaugeHeroConfig(value: 48.6, max: 75, label: "Usable energy", unit: "kWh", tint: .energy),
                stats: [
                    GaugeHeroStat(label: "Capacity", value: "75.0", unit: "kWh"),
                    GaugeHeroStat(label: "Reserve", value: "10", unit: "%")
                ],
                locale: Locale(identifier: "en_US")
            )
        }
    }

    #Preview("Standard — gauge only (no stats)") {
        staged("speed gauge · integer reading · no stats row") {
            WidgetGaugeHero(
                gauge: GaugeHeroConfig(value: 63, max: 200, label: "Speed", unit: "km/h", tint: .speed),
                locale: Locale(identifier: "en_US")
            )
        }
    }

    #Preview("Compact — condensed ring") {
        staged("compact · 70pt ring · stats + accessory suppressed") {
            WidgetGaugeHero(
                gauge: GaugeHeroConfig(value: 92, max: 100, label: "Health", unit: "%", tint: .success),
                stats: sampleStats(),
                compact: true,
                locale: Locale(identifier: "en_US")
            ) {
                Text(verbatim: "hidden in compact")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    #Preview("Tints — semantic palette") {
        staged("accent · warning · danger · power") {
            VStack(spacing: TSSpacing.lg) {
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 30, max: 100, label: "Accent", unit: "%", tint: .accent),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 55, max: 100, label: "Power", unit: "kW", tint: .power),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 88, max: 100, label: "Cabin", unit: "°C", tint: .temperature),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
            }
        }
    }

    #Preview("Edge — clamps, zero, degenerate max") {
        staged("value > max clamps to full · zero reading · max<=0 guards to empty arc") {
            VStack(spacing: TSSpacing.lg) {
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 140, max: 100, label: "Over scale", unit: "%", tint: .warning),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 0, max: 100, label: "Empty", unit: "%", tint: .danger),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
                WidgetGaugeHero(
                    gauge: GaugeHeroConfig(value: 5, max: 0, label: "No scale", unit: "", tint: .info),
                    compact: true,
                    locale: Locale(identifier: "en_US")
                )
            }
        }
    }
#endif
