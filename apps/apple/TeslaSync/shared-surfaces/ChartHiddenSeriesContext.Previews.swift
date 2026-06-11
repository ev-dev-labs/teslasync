//
//  ChartHiddenSeriesContext.Previews.swift
//  TeslaSync — P4 shared surface · 0067 · ChartHiddenSeriesContext (Apple)
//
//  Xcode previews for every real branch of the hidden-series bridge: the live composite (tap a chip to
//  hide its series in the chart and dim the chip), a provider seeded so two series start hidden (the
//  persisted-toggle branch, visible without interaction), and a standalone legend with no provider (the
//  faithful "no context" branch — inert, never dimmed). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func seededStore(hidden: Set<String>, chartKey: String) -> HiddenSeriesStore {
        let store = HiddenSeriesStore()
        store.setHidden(hidden, for: chartKey)
        return store
    }

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

    #Preview("Composite · all shown") {
        ChartHiddenSeriesContextSample(chartKey: "preview-all-shown")
    }

    #Preview("Composite · two hidden (seeded)") {
        staged("provider · health shown, projected + fleet hidden") {
            ChartHiddenSeriesProvider(
                chartKey: "preview-seeded",
                store: seededStore(hidden: ["projected", "fleet"], chartKey: "preview-seeded")
            ) {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ChartHiddenSeriesSampleChart()
                    HStack(spacing: TSSpacing.sm) {
                        ForEach(ChartHiddenSeriesSampleData.series) { series in
                            ChartHiddenSeriesLegendChip(series: series)
                        }
                    }
                }
            }
        }
    }

    #Preview("Standalone (no provider)") {
        staged("no provider · context is nil · chips inert") {
            HStack(spacing: TSSpacing.sm) {
                ForEach(ChartHiddenSeriesSampleData.series) { series in
                    ChartHiddenSeriesLegendChip(series: series)
                }
            }
        }
    }
#endif
