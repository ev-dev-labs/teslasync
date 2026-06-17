//
//  SignalsWorkspacePageLive.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Panel 11 (GlassPanel11, content half): stats + history (or the live tail),
//  the chart-layout segmented control, and the catalog refresh footer. Renders
//  the historical (useSignals history) and live (SSE) data states.
//

import SwiftUI

// MARK: - Stats panel

/// Per-signal min / max / avg / count (web WorkspaceStatsPanel). The chart-layout
/// control reshapes the grid (overlay = single column, grid = adaptive).
struct WorkspaceStatsPanel: View {
    let stats: [WorkspaceSignalStat]
    let layout: WorkspaceChartLayout

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 10) {
                Text(WSText.historyTitle).font(.headline)
                LazyVGrid(columns: gridColumns, alignment: .leading, spacing: 10) {
                    ForEach(stats) { stat in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(stat.signal)
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(1)
                            Text(summary(stat)).font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var gridColumns: [GridItem] {
        switch layout {
        case .overlay: [GridItem(.flexible(), alignment: .leading)]
        case .grid: [GridItem(.adaptive(minimum: 120), alignment: .leading)]
        case .auto: [GridItem(.adaptive(minimum: 160), alignment: .leading)]
        }
    }

    private func summary(_ stat: WorkspaceSignalStat) -> String {
        String(
            format: "min %.1f · max %.1f · avg %.1f · n %d",
            stat.min, stat.max, stat.avg, stat.count
        )
    }
}

// MARK: - Chart layout picker

struct ChartLayoutPicker: View {
    @Bindable var model: SignalsWorkspacePageModel

    var body: some View {
        HStack(spacing: 8) {
            Text(WSText.chartMode).font(.caption).foregroundStyle(.secondary)
            Picker(WSText.chartMode, selection: $model.chartLayout) {
                Text(WSText.chartAuto).tag(WorkspaceChartLayout.auto)
                Text(WSText.chartOverlay).tag(WorkspaceChartLayout.overlay)
                Text(WSText.chartGrid).tag(WorkspaceChartLayout.grid)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(maxWidth: 280)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityLabel(WSText.chartMode)
    }
}

// MARK: - History table

struct HistoryTableView: View {
    @Bindable var model: SignalsWorkspacePageModel

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 10) {
                Text(WSText.historyTitle).font(.headline)
                ForEach(model.paginatedHistory) { entry in
                    historyRow(entry)
                    Divider()
                }
                paginationControls
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(WSText.historyTitle)
    }

    private func historyRow(_ entry: SignalHistoryEntry) -> some View {
        HStack(spacing: 10) {
            Text(entry.signal).font(.system(.caption, design: .monospaced)).lineLimit(1)
            Spacer()
            Text(entry.value.display).font(.system(.caption, design: .monospaced))
            Text(entry.timestamp, format: .dateTime.hour().minute().second())
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var paginationControls: some View {
        HStack {
            Button("Previous", systemImage: "chevron.left") {
                if model.page > 1 { model.page -= 1 }
            }
            .disabled(model.page <= 1)
            Spacer()
            Text("\(model.page) / \(model.totalHistoryPages)")
                .font(.caption).foregroundStyle(.secondary)
            Spacer()
            Button("Next", systemImage: "chevron.right") {
                if model.page < model.totalHistoryPages { model.page += 1 }
            }
            .disabled(model.page >= model.totalHistoryPages)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

// MARK: - Live tail

struct LiveTailView: View {
    @Bindable var model: SignalsWorkspacePageModel

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 10) {
                header
                if model.isLiveStale { staleBanner }
                liveBody
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(WSText.liveTailTitle)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(WSText.liveTailTitle).font(.headline)
            connectionBadge
            Spacer()
            Button(model.livePaused ? "Resume" : "Pause", systemImage: model.livePaused ? "play" : "pause") {
                model.setLivePaused(!model.livePaused)
            }
            .buttonStyle(.bordered).controlSize(.small)
            Button("Clear", systemImage: "trash", action: model.clearLiveTail)
                .buttonStyle(.bordered).controlSize(.small)
        }
    }

    private var connectionBadge: some View {
        Label(
            model.liveConnected ? WSText.liveConnected : WSText.liveDisconnected,
            systemImage: "circle.fill"
        )
        .font(.caption2)
        .foregroundStyle(model.liveConnected ? .green : .red)
    }

    private var staleBanner: some View {
        Label("Live data is more than 2 minutes old", systemImage: "clock.badge.exclamationmark")
            .font(.caption)
            .foregroundStyle(.orange)
    }

    @ViewBuilder private var liveBody: some View {
        switch model.livePhase {
        case .loading:
            WorkspaceStateLoading(rows: 5, label: WSText.liveTailTitle)
        case .empty:
            WorkspaceStateEmpty(
                title: WSText.liveTailTitle,
                message: WSText.noVehicleDesc,
                systemImage: "dot.radiowaves.left.and.right"
            )
        case let .error(message):
            WorkspaceStateError(message: message) { model.startLive() }
        case .success:
            liveRows
        }
    }

    @ViewBuilder private var liveRows: some View {
        if model.liveTail.isEmpty {
            WorkspaceStateEmpty(
                title: WSText.liveTailTitle,
                message: WSText.liveRate,
                systemImage: "waveform.path.ecg"
            )
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(model.liveTail.prefix(120)) { entry in
                        liveRow(entry)
                        Divider()
                    }
                }
            }
            .frame(maxHeight: 360)
        }
    }

    private func liveRow(_ entry: LiveTailEntry) -> some View {
        HStack(spacing: 10) {
            Text(entry.signal).font(.system(.caption, design: .monospaced)).lineLimit(1)
            Spacer()
            Text(entry.value.display).font(.system(.caption, design: .monospaced))
            Text(entry.timestamp, format: .dateTime.hour().minute().second())
                .font(.caption2).foregroundStyle(.secondary)
        }
    }
}

// MARK: - Panel 11 · Historical / Live content

/// Completes the catalog panel: stats + history (or live tail), or the empty
/// "pick signals and run" prompt. Renders the historical data source's states.
struct HistoricalLiveSection: View {
    @Bindable var model: SignalsWorkspacePageModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if model.mode == .live {
                liveContent
            } else if model.hasRunHistory {
                historicalContent
            } else {
                emptyPrompt
            }
        }
    }

    @ViewBuilder private var liveContent: some View {
        if model.selectedSignals.count >= 2 { ChartLayoutPicker(model: model) }
        WorkspaceStatsPanel(stats: model.activeStats, layout: model.chartLayout)
        LiveTailView(model: model)
    }

    @ViewBuilder private var historicalContent: some View {
        switch model.historyPhase {
        case .loading:
            WorkspacePanel { WorkspaceStateLoading(rows: 6, label: WSText.historyTitle) }
        case .empty:
            WorkspacePanel {
                WorkspaceStateEmpty(
                    title: WSText.emptyTitle,
                    message: WSText.emptyDesc,
                    systemImage: "cylinder.split.1x2"
                )
            }
        case let .error(message):
            WorkspacePanel {
                WorkspaceStateError(message: message) { Task { await model.retryHistory() } }
            }
        case .success:
            if model.selectedSignals.count >= 2 { ChartLayoutPicker(model: model) }
            WorkspaceStatsPanel(stats: model.activeStats, layout: model.chartLayout)
            HistoryTableView(model: model)
        }
    }

    private var emptyPrompt: some View {
        WorkspacePanel {
            WorkspaceStateEmpty(
                title: WSText.emptyTitle,
                message: WSText.emptyDesc,
                systemImage: "cylinder.split.1x2"
            )
        }
    }
}

// MARK: - Catalog refresh footer

struct WorkspaceFooter: View {
    var body: some View {
        HStack(spacing: 4) {
            Spacer()
            Image(systemName: "arrow.clockwise").font(.caption2)
            Text(WSText.refreshInterval).font(.caption2)
        }
        .foregroundStyle(.secondary)
        .accessibilityLabel(WSText.refreshInterval)
    }
}
