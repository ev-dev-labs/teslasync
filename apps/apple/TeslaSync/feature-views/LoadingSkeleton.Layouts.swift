//
//  LoadingSkeleton.Layouts.swift
//  TeslaSync — P4 feature view · LoadingSkeleton (Apple)
//
//  The two static ``LoadingSkeletonLayout`` projections — one per web source that
//  maps to this native filename — kept beside the model types they are built
//  from. Each reproduces its source's region tree block-for-block (Tailwind
//  1 unit = 4 pt); the XCTest suite asserts both against the web dimensions.
//
//    • `.chargingCurve` ← `charging-curve/LoadingSkeleton.tsx` (P4·0088)
//    • `.costAnalysis`  ← `cost-analysis/LoadingSkeleton.tsx`  (P4·0115)
//

import Foundation

public extension LoadingSkeletonLayout {
    /// The charging-curve loading skeleton (web
    /// `charging-curve/LoadingSkeleton.tsx`, P4·0088), projected 1:1. Seven
    /// stacked regions; Tailwind sizes use the canonical 1 unit = 4 pt scale.
    static let chargingCurve = LoadingSkeletonLayout(
        regions: [
            .header(SkeletonHeader(
                title: .fixed(192, height: 32),
                subtitle: .fixed(288, height: 16, topInset: 8)
            )),
            .filterRow([.fixed(192, height: 40), .fixed(256, height: 40)]),
            .statGrid(SkeletonStatGrid(
                cells: Array(
                    repeating: SkeletonStatCell(lines: [
                        .fixed(64, height: 12),
                        .fixed(80, height: 28, topInset: 8)
                    ]),
                    count: 6
                ),
                columns: ResponsiveColumns(compact: 2, regular: 6),
                gap: .gap4
            )),
            .chartPanel(SkeletonChartPanel(
                title: .fixed(160, height: 20),
                chartBody: .fill(height: 256, topInset: 16)
            )),
            .chartPanel(SkeletonChartPanel(
                title: .fixed(224, height: 20),
                chartBody: .fill(height: 208, topInset: 16)
            )),
            .chartGrid(SkeletonChartGrid(
                panels: Array(
                    repeating: SkeletonChartPanel(
                        title: .fixed(176, height: 20),
                        chartBody: .fill(height: 192, topInset: 16)
                    ),
                    count: 2
                ),
                columns: ResponsiveColumns(compact: 1, regular: 2),
                gap: .gap6
            )),
            .statGrid(SkeletonStatGrid(
                cells: Array(
                    repeating: SkeletonStatCell(lines: [
                        .fixed(80, height: 12),
                        .fixed(64, height: 28, topInset: 8)
                    ]),
                    count: 4
                ),
                columns: ResponsiveColumns(compact: 2, regular: 4),
                gap: .gap4
            ))
        ],
        accessibilityLabelKey: "chargingCurve.loading.accessibilityLabel",
        accessibilityLabelFallback: "Loading charging analysis"
    )

    /// The cost-analysis loading skeleton (web
    /// `cost-analysis/LoadingSkeleton.tsx`, P4·0115), projected 1:1. Four stacked
    /// regions: a header with a trailing pill button, a 6-tile card grid with
    /// three lines each, a two-up chart grid, and a five-row table.
    static let costAnalysis = LoadingSkeletonLayout(
        regions: [
            .header(SkeletonHeader(
                title: .fixed(220, height: 28),
                subtitle: .fixed(340, height: 16, topInset: 8),
                trailingAccessory: .fixed(200, height: 36, shape: .pill)
            )),
            .statGrid(SkeletonStatGrid(
                cells: Array(
                    repeating: SkeletonStatCell(lines: [
                        .fraction(0.6, height: 14),
                        .fraction(0.8, height: 24, topInset: 8),
                        .fraction(0.4, height: 12, topInset: 4)
                    ]),
                    count: 6
                ),
                columns: ResponsiveColumns(compact: 2, regular: 6),
                gap: .gap4
            )),
            .chartGrid(SkeletonChartGrid(
                panels: Array(
                    repeating: SkeletonChartPanel(
                        title: .fraction(0.4, height: 16),
                        chartBody: .fill(height: 200, topInset: 16)
                    ),
                    count: 2
                ),
                columns: ResponsiveColumns(compact: 1, regular: 2),
                gap: .gap4
            )),
            .table(SkeletonTable(
                title: .fraction(0.3, height: 16),
                rowHeight: 32,
                rowCount: 5,
                rowSpacing: 8,
                rowsTopInset: 16
            ))
        ],
        accessibilityLabelKey: "costAnalysis.loading.accessibilityLabel",
        accessibilityLabelFallback: "Loading cost analysis"
    )
}
