//
//  WidgetComparisonCard.Previews.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  Xcode previews for every real branch of the comparison card: the populated column across mixed
//  directions (higher-/lower-better) and edge endpoints (a zero-previous that renders the indicator's
//  em-dash, an equal pair that renders the neutral arrow), the `compact` two-row slice, a single-row card,
//  and the empty leaf. DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate
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
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
        .tsUnits(.metric)
    }

    private func sampleMetrics() -> [ComparisonMetric] {
        [
            ComparisonMetric(
                label: "Distance",
                current: 1420,
                previous: 1360,
                formattedCurrent: "1,420",
                unit: "km",
                higherIsBetter: true
            ),
            ComparisonMetric(
                label: "Efficiency",
                current: 268,
                previous: 281,
                formattedCurrent: "268",
                unit: "Wh/km",
                higherIsBetter: false
            ),
            ComparisonMetric(
                label: "Charging cost",
                current: 42,
                previous: 0,
                formattedCurrent: "$42.10",
                higherIsBetter: false
            ),
            ComparisonMetric(
                label: "Trips",
                current: 18,
                previous: 18,
                formattedCurrent: "18",
                higherIsBetter: true
            )
        ]
    }

    #Preview("Populated — mixed directions") {
        staged("four metrics · higher/lower · zero-previous · equal") {
            WidgetComparisonCard(metrics: sampleMetrics())
        }
    }

    #Preview("Compact — first two") {
        staged("compact · slices to the first two metrics") {
            WidgetComparisonCard(metrics: sampleMetrics(), compact: true)
        }
    }

    #Preview("Single row") {
        staged("one metric · no trailing separator") {
            WidgetComparisonCard(
                metrics: [
                    ComparisonMetric(
                        label: "Range added",
                        current: 312,
                        previous: 298,
                        formattedCurrent: "312",
                        unit: "km",
                        higherIsBetter: true
                    )
                ]
            )
        }
    }

    #Preview("Empty — nothing to compare") {
        staged("no metrics · friendly empty leaf · never a blank box") {
            WidgetComparisonCard(metrics: [])
        }
    }
#endif
