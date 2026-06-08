//
//  ComputedMetricEditor.Previews.swift
//  TeslaSync — P4 feature view · 0182 · ComputedMetricEditor (Apple)
//
//  Xcode previews for the surface across every registry-source state (content /
//  loading / empty / error / stale / offline) and every preview state (idle /
//  computing / value would-fire / value would-NOT-fire / error / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private let previewMetrics: [ComputedMetricSummary] = [
        ComputedMetricSummary(
            id: "cost_per_mi",
            label: "Cost per mile",
            unit: "currency_per_mi",
            windows: ["7d", "30d", "90d"],
            ops: [.greaterThan, .lessThan, .greaterThanOrEqual]
        ),
        ComputedMetricSummary(
            id: "energy_added",
            label: "Energy added",
            unit: "kwh",
            windows: ["24h", "7d"],
            ops: [.greaterThan, .lessThan, .percentChangeGreater, .percentChangeLess]
        ),
        ComputedMetricSummary(
            id: "efficiency",
            label: "Efficiency",
            unit: "wh_per_mi",
            windows: ["7d", "30d"],
            ops: ComputedMetricOp.allCases
        )
    ]

    private let readyValue = ComputedMetricEditorValue(
        metricID: "cost_per_mi",
        metricWindow: "7d",
        metricOp: .greaterThan,
        metricThreshold: "200"
    )

    @MainActor
    private struct CMEPreviewHost: View {
        @State var value: ComputedMetricEditorValue
        let registryState: ComputedMetricLoadState<[ComputedMetricSummary]>
        var previewOutcome: ComputedMetricPreviewOutcome?
        var autoResponds = true

        var body: some View {
            ScrollView {
                ComputedMetricEditor(
                    value: $value,
                    registry: ComputedMetricRegistryModel(previewState: registryState),
                    preview: ComputedMetricPreviewModel(
                        runner: InMemoryComputedMetricPreviewRunner(
                            outcome: previewOutcome,
                            autoResponds: autoResponds
                        )
                    )
                )
                .padding()
            }
            .frame(maxWidth: 680)
            .background(Color.TS.bg)
        }
    }

    #Preview("Content · would NOT fire") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: false),
            previewOutcome: .success(ComputedMetricPreviewResult(value: 0.21, wouldTrigger: false))
        )
    }

    #Preview("Content · would fire") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: false),
            previewOutcome: .success(ComputedMetricPreviewResult(value: 250, wouldTrigger: true))
        )
    }

    #Preview("Preview · computing") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: false),
            previewOutcome: nil,
            autoResponds: false
        )
    }

    #Preview("Preview · error") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: false),
            previewOutcome: .failure(message: "Preview request timed out")
        )
    }

    #Preview("Preview · offline") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: false),
            previewOutcome: .offline(message: "Offline — showing the last preview")
        )
    }

    #Preview("Idle · not ready") {
        CMEPreviewHost(
            value: ComputedMetricEditorValue(),
            registryState: .loaded(previewMetrics, stale: false)
        )
    }

    #Preview("Registry · loading") {
        CMEPreviewHost(
            value: ComputedMetricEditorValue(),
            registryState: .loading(cached: nil, stale: false)
        )
    }

    #Preview("Registry · empty") {
        CMEPreviewHost(
            value: ComputedMetricEditorValue(),
            registryState: .empty(stale: false)
        )
    }

    #Preview("Registry · error") {
        CMEPreviewHost(
            value: ComputedMetricEditorValue(),
            registryState: .failed(.network(message: "503"), cached: nil, stale: false)
        )
    }

    #Preview("Registry · stale") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .loaded(previewMetrics, stale: true),
            previewOutcome: .success(ComputedMetricPreviewResult(value: 0.21, wouldTrigger: false))
        )
    }

    #Preview("Registry · offline cached") {
        CMEPreviewHost(
            value: readyValue,
            registryState: .failed(.offline, cached: previewMetrics, stale: true),
            previewOutcome: .success(ComputedMetricPreviewResult(value: 0.21, wouldTrigger: false))
        )
    }
#endif
