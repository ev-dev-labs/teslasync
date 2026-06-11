//
//  ChartContainer.Previews.swift
//  TeslaSync — P4 shared surface · 0065 · ChartContainer (Apple)
//
//  Xcode previews for each surface state (ready / loading / empty / error / stale / offline / with
//  annotations) plus the fallback-table variant. DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope. The sample content resolves through the P1/S10 facade so the
//  previews carry no hardcoded literals.
//

import SwiftUI

#if DEBUG
    enum ChartContainerPreviewData {
        static var content: ChartContainerContent {
            ChartContainerContent(
                title: ChartContainerStrings.string("chartContainer.preview.title", "Battery degradation"),
                subtitle: ChartContainerStrings.string("chartContainer.preview.subtitle", "Last 30 days"),
                ariaLabel: ChartContainerStrings.string(
                    "chartContainer.preview.ariaLabel",
                    "Battery state-of-health trend over the last 30 days"
                ),
                hasExportData: true
            )
        }

        static var annotatedContent: ChartContainerContent {
            ChartContainerContent(
                title: ChartContainerStrings.string("chartContainer.preview.title", "Battery degradation"),
                ariaLabel: ChartContainerStrings.string(
                    "chartContainer.preview.ariaLabel",
                    "Battery state-of-health trend over the last 30 days"
                ),
                annotationsEnabled: true,
                annotationKey: "preview-battery",
                scope: .battery
            )
        }

        static let rows: [ChartContainerAnnotationRow] = [
            ChartContainerAnnotationRow(
                id: 1,
                vehicleID: 7,
                occurredAt: "2026-05-02T10:00:00Z",
                category: "maintenance",
                title: "Tire rotation",
                description: "Rotated + balanced",
                scope: ["battery"],
                createdAt: "2026-05-02T10:00:00Z",
                updatedAt: "2026-05-02T10:00:00Z"
            ),
            ChartContainerAnnotationRow(
                id: 2,
                vehicleID: 7,
                occurredAt: "2026-05-20T10:00:00Z",
                category: "upgrade",
                title: "Software 2026.14",
                scope: ["battery"],
                createdAt: "2026-05-20T10:00:00Z",
                updatedAt: "2026-05-20T10:00:00Z"
            )
        ]

        static let columns: [ChartContainerDataColumn] = [
            ChartContainerDataColumn(key: "day", label: "Day"),
            ChartContainerDataColumn(key: "soh", label: "SoH %")
        ]

        static let data: [ChartContainerDataRow] = [
            ["day": .text("May 1"), "soh": .number(94)],
            ["day": .text("May 15"), "soh": .number(93)],
            ["day": .text("May 30"), "soh": .number(92)]
        ]
    }

    /// A representative line drawing standing in for a real chart in previews (not shipped UI copy).
    private struct ChartContainerPreviewChart: View {
        var body: some View {
            GeometryReader { geo in
                Path { path in
                    let points: [CGFloat] = [0.2, 0.35, 0.3, 0.55, 0.5, 0.75, 0.7, 0.9]
                    for (index, value) in points.enumerated() {
                        let point = CGPoint(
                            x: geo.size.width * CGFloat(index) / CGFloat(points.count - 1),
                            y: geo.size.height * (1 - value)
                        )
                        if index == 0 {
                            path.move(to: point)
                        } else {
                            path.addLine(to: point)
                        }
                    }
                }
                .stroke(Color.TS.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            }
        }
    }

    @MainActor
    private func previewModel(
        _ input: ChartContainerInput,
        content: ChartContainerContent = ChartContainerPreviewData.content
    ) -> ChartContainerModel {
        let model = ChartContainerModel(
            content: content,
            source: InMemoryChartContainerSource(initial: input),
            hiddenStore: InMemoryChartContainerHiddenStore()
        )
        model.start()
        return model
    }

    @MainActor
    private func staged(_ model: ChartContainerModel, body: ChartContainerBodyState = .init()) -> some View {
        ChartContainer(model: model, loading: body.loading, empty: body.empty, hasError: body.hasError) { _ in
            ChartContainerPreviewChart()
        }
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }

    #Preview("Ready") {
        staged(previewModel(ChartContainerInput(connection: .live)))
    }

    #Preview("Loading") {
        staged(previewModel(ChartContainerInput()), body: .init(loading: true))
    }

    #Preview("Empty") {
        staged(previewModel(ChartContainerInput()), body: .init(empty: true))
    }

    #Preview("Error") {
        staged(previewModel(ChartContainerInput()), body: .init(hasError: true))
    }

    #Preview("Stale") {
        staged(previewModel(ChartContainerInput(connection: .stale)))
    }

    #Preview("Offline") {
        staged(previewModel(ChartContainerInput(connection: .offline)))
    }

    #Preview("With annotations") {
        ChartContainer(
            model: previewModel(
                ChartContainerInput(connection: .live, annotations: ChartContainerPreviewData.rows),
                content: ChartContainerPreviewData.annotatedContent
            )
        ) { _ in
            ChartContainerPreviewChart()
        }
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }

    #Preview("Fallback table") {
        ChartContainer(
            model: previewModel(ChartContainerInput(connection: .live)),
            data: ChartContainerPreviewData.data,
            dataColumns: ChartContainerPreviewData.columns
        ) { _ in
            ChartContainerPreviewChart()
        }
        .padding()
        .frame(maxWidth: 480)
        .background(Color.TS.bg)
    }
#endif
