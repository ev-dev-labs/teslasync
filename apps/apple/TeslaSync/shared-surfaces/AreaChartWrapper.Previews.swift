//
//  AreaChartWrapper.Previews.swift
//  TeslaSync — P4 shared surface · 0064 · AreaChartWrapper (Apple)
//
//  Xcode previews for each surface state (loading / error / empty / withdrawn / populated-single /
//  populated-multi / populated-stale / populated-offline). The single-series payload mirrors the real
//  web call sites (battery % over an index x, web `yFormatter={(v) => `${v}%`}`); the multi-series
//  payload overlays two gradient areas. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AreaChartPreviewData {
        /// Single-series battery-percent payload — the parity of the web `RecentActivity` battery
        /// trend (`series=[{ key: 'v', label: 'Battery %', color: '#10b981' }]`, `yFormatter` → `%`).
        static func battery() -> AreaChartData {
            let rows: [AreaChartRow] = (0 ..< 24).map { index in
                let value = 62 + 28 * sin(Double(index) / 5) + Double(index) * 0.3
                return AreaChartRow(x: "\(index)", values: ["v": min(100, value)])
            }
            return AreaChartData(
                rows: rows,
                series: [AreaChartSeries(id: "v", label: "Battery %", colorHex: "#10b981", colorIndex: 2)]
            )
        }

        /// Two-series payload — battery vs energy, overlaid gradient areas (one series sparse so its
        /// missing rows simply leave gaps, the web non-finite skip).
        static func dual() -> AreaChartData {
            let rows: [AreaChartRow] = (0 ..< 30).map { index in
                var values: [String: Double] = ["battery": 70 + 20 * sin(Double(index) / 6)]
                if index % 2 == 0 {
                    values["energy"] = 10 + 8 * cos(Double(index) / 4)
                }
                return AreaChartRow(x: "\(index)", values: values)
            }
            return AreaChartData(
                rows: rows,
                series: [
                    AreaChartSeries(id: "battery", label: "Battery %", colorHex: "#10b981", colorIndex: 2),
                    AreaChartSeries(id: "energy", label: "kWh", colorHex: "#f59e0b", colorIndex: 1)
                ]
            )
        }
    }

    @MainActor
    private func previewModel(_ input: AreaChartInput) -> AreaChartWrapperModel {
        let source = InMemoryAreaChartSource(initial: input)
        let model = AreaChartWrapperModel(source: source)
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: AreaChartWrapperModel) -> some View {
        ScrollView {
            AreaChartWrapper(model: model)
                .padding()
        }
        .frame(maxWidth: 640)
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        staged(previewModel(AreaChartInput(availability: .loading, height: 220)))
    }

    #Preview("Error") {
        staged(previewModel(AreaChartInput(availability: .failed("Network timed out"), height: 220)))
    }

    #Preview("Empty (shown)") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartData()),
            emptyBehavior: .emptyState,
            height: 220
        )))
    }

    #Preview("Withdrawn (empty payload)") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartData()),
            emptyBehavior: .withdraw,
            height: 220
        )))
    }

    #Preview("Populated single") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartPreviewData.battery()),
            connection: .live,
            height: 220,
            valueFormat: AreaValueFormat(suffix: "%")
        )))
    }

    #Preview("Populated multi") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartPreviewData.dual()),
            connection: .live,
            height: 220
        )))
    }

    #Preview("Populated stale") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartPreviewData.battery()),
            connection: .stale,
            height: 220,
            valueFormat: AreaValueFormat(suffix: "%")
        )))
    }

    #Preview("Populated offline") {
        staged(previewModel(AreaChartInput(
            availability: .resolved(AreaChartPreviewData.battery()),
            connection: .offline,
            height: 220,
            valueFormat: AreaValueFormat(suffix: "%")
        )))
    }
#endif
