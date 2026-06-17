//
//  StateMachineDebuggerPageCharts.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Charts & Diagram
//
//  The native Swift Charts surfaces of the debugger (never a WKWebView): the state-distribution
//  donut (web `ChartContainer` + `PieChart`) beside the transition-counts table (web GlassPanel5),
//  the state-diagram overview (web `FSMStateDiagram`, adapted as a count-annotated state grid),
//  and the transition-timeline bar chart (web `FSMTimelineChart`). Each renders its own empty
//  state (never a blank region) and an accessible summary. Copy resolves from `Localizable.xcstrings`.
//

import SwiftUI

// MARK: - Distribution + counts row (web section 6)

/// The two-up distribution donut + transition-counts table, stacking on compact widths.
struct FSMDebuggerDistributionRow: View {
    let model: StateMachineDebuggerPageModel
    let isCompact: Bool

    var body: some View {
        let columns = [GridItem(.adaptive(minimum: isCompact ? 280 : 320), spacing: TSSpacing.lg)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            FSMDebuggerDistributionChart(slices: model.slices, emptyMessage: model.emptyRangeMessage)
            FSMDebuggerCountsPanel(rows: model.summaryRows, emptyMessage: model.emptyRangeMessage)
        }
    }
}

// MARK: - State-Distribution (web ChartContainer + PieChart)

/// The state-distribution donut (web "State Distribution"): a `TSPieChart` over the per-`to_state`
/// counts, with a State / Count legend, or the range-aware empty state.
struct FSMDebuggerDistributionChart: View {
    let slices: [StateDistributionSlice]
    let emptyMessage: String

    private var pieSlices: [TSChartSlice] {
        slices.map { slice in
            TSChartSlice(
                id: slice.name,
                name: LocalizedStringKey(slice.name),
                nameText: slice.name,
                value: Double(slice.value),
                colorIndex: slice.colorIndex
            )
        }
    }

    var body: some View {
        TSChartContainer("fsm.distributionByState", summary: "fsm.distributionByState.aria") {
            if slices.isEmpty {
                TSEmptyState(title: LocalizedStringKey(emptyMessage), systemImage: "chart.pie")
                    .frame(maxWidth: .infinity, minHeight: 220)
            } else {
                VStack(spacing: TSSpacing.md) {
                    TSPieChart(slices: pieSlices, showsLegend: false)
                        .frame(height: 220)
                        .accessibilityLabel(Text("fsm.distributionByState.aria"))
                    legend
                }
            }
        }
    }

    private var legend: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack {
                TSLabel("fsm.col.state")
                Spacer()
                TSLabel("fsm.col.count")
            }
            ForEach(slices) { slice in
                HStack(spacing: TSSpacing.xs) {
                    Circle().fill(TSChartPalette.color(at: slice.colorIndex)).frame(width: 8, height: 8)
                    Text(verbatim: slice.name).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                    Spacer()
                    Text(verbatim: StateMachineFormat.integer(slice.value))
                        .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
                }
            }
        }
    }
}

// MARK: - GlassPanel5 — Transition Counts (web section 6b)

/// The per-`to_state` transition-counts table (web "Transition Counts"): state chip + count +
/// average interval, or the range-aware empty state.
struct FSMDebuggerCountsPanel: View {
    let rows: [StateSummaryRow]
    let emptyMessage: String

    private var columns: [TSColumn<StateSummaryRow>] {
        [
            TSColumn(id: "state", title: "fsm.state") { row in
                FSMDebuggerStateBadge(state: row.toState)
            },
            TSColumn(id: "count", title: "fsm.count") { row in
                Text(verbatim: StateMachineFormat.integer(row.count)).monospacedDigit()
            },
            TSColumn(id: "avg", title: "fsm.avgInterval") { row in
                Text(verbatim: row.avgIntervalSec > 0
                    ? StateMachineFormat.duration(row.avgIntervalSec)
                    : StateMachineFormat.emptyValue)
                    .monospacedDigit()
            }
        ]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("fsm.transitionCounts")
                if rows.isEmpty {
                    TSEmptyState(title: LocalizedStringKey(emptyMessage), systemImage: "tablecells")
                        .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    TSDataTable(rows: rows, columns: columns, density: .compact)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - State diagram overview (web FSMStateDiagram)

/// A native adaptation of the web state-diagram graph: a grid of state nodes annotated with their
/// inbound / outbound transition counts (an SVG graph is replaced by a HIG-native count grid).
struct FSMDebuggerStateDiagramPanel: View {
    let nodes: [StateDiagramNode]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "point.topleft.down.to.point.bottomright.curvepath")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("fsm.stateDiagramTitle")
                }
                if nodes.isEmpty {
                    TSEmptyState(title: "fsm.noState", systemImage: "circle.grid.cross")
                        .frame(maxWidth: .infinity, minHeight: 140)
                } else {
                    grid
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var grid: some View {
        let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(nodes) { node in FSMDebuggerDiagramNode(node: node) }
        }
    }
}

/// One state node tile: the state chip over its inbound (↓) and outbound (↑) counts.
struct FSMDebuggerDiagramNode: View {
    let node: StateDiagramNode

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FSMDebuggerStateBadge(state: node.state)
            HStack(spacing: TSSpacing.md) {
                countLabel(systemImage: "arrow.down.to.line", value: node.inbound)
                countLabel(systemImage: "arrow.up.right", value: node.outbound)
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private func countLabel(systemImage: String, value: Int) -> some View {
        HStack(spacing: 2) {
            Image(systemName: systemImage).font(.caption2)
            Text(verbatim: StateMachineFormat.integer(value)).font(Font.TS.caption).monospacedDigit()
        }
        .foregroundStyle(Color.TS.textMuted)
    }
}

// MARK: - Transition timeline (web FSMTimelineChart)

/// The transition-timeline bar chart (web "Transition Timeline"): counts bucketed over the window,
/// or the range-aware empty state.
struct FSMDebuggerTimelinePanel: View {
    let series: TSChartSeries
    let isEmpty: Bool
    let emptyMessage: String

    var body: some View {
        TSChartContainer("fsm.timelineChartTitle") {
            if isEmpty {
                TSEmptyState(title: LocalizedStringKey(emptyMessage), systemImage: "chart.bar.xaxis")
                    .frame(maxWidth: .infinity, minHeight: 200)
            } else {
                TSBarChart(series: [series])
                    .frame(height: 200)
                    .accessibilityLabel(Text("fsm.timelineChartTitle"))
            }
        }
    }
}
