//
//  LiveSignalMonitorPageViews.swift
//  TeslaSync — P4-APPLE · P7 · page:telemetry/LiveSignalMonitor (Apple)
//
//  The shared `LiveSignalTail` rendered SwiftUI-native: the controls row
//  (filter / pause / auto-scroll / clear), the four stat tiles, and the
//  scrolling Time · Signal · Value · Type · Freshness table. Reuses the
//  Telemetry feature's `WorkspacePanel` / `WorkspaceStatCard` /
//  `WorkspaceState*` chrome so the monitor and the `/signals` workspace stay in
//  lock-step (web reuses the same `LiveSignalTail` component across both).
//

import SwiftUI

// MARK: - Tail panel (web LiveSignalTail GlassPanel)

struct LiveSignalTailPanel: View {
    @Bindable var model: LiveSignalMonitorPageModel

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 14) {
                LiveTailControls(model: model)
                LiveTailStatGrid(model: model)
                LiveTailBody(model: model)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LMText.title)
    }
}

// MARK: - Controls (filter · pause · auto-scroll · clear)

struct LiveTailControls: View {
    @Bindable var model: LiveSignalMonitorPageModel

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { controls }
            VStack(alignment: .leading, spacing: 10) { controls }
        }
    }

    @ViewBuilder private var controls: some View {
        TextField(LMText.filterPrompt, text: $model.filter)
            .textFieldStyle(.roundedBorder)
            .frame(maxWidth: 280)
            .accessibilityLabel(LMText.filterLabel)

        Spacer(minLength: 0)

        Button(model.tailPaused ? LMText.resume : LMText.pause,
               systemImage: model.tailPaused ? "play.fill" : "pause.fill") {
            model.togglePause()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)

        Button(LMText.autoScroll, systemImage: "arrow.down.to.line") {
            model.toggleAutoScroll()
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .tint(model.autoScroll ? .accentColor : nil)
        .accessibilityAddTraits(model.autoScroll ? [.isSelected] : [])

        Button(role: .destructive) {
            model.clearTail()
        } label: {
            Label(LMText.clear, systemImage: "trash")
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
    }
}

// MARK: - Stat tiles (Signals/sec · Buffer · Unique · Filtered)

struct LiveTailStatGrid: View {
    let model: LiveSignalMonitorPageModel

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: 140), spacing: 12)] }

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            WorkspaceStatCard(
                label: LMText.sigPerSec,
                value: "\(model.tailRate)",
                systemImage: "waveform.path.ecg"
            )
            WorkspaceStatCard(
                label: LMText.bufferSize,
                value: "\(model.bufferSize) / \(model.tailMax)",
                systemImage: "arrow.up.arrow.down"
            )
            WorkspaceStatCard(
                label: LMText.uniqueSignals,
                value: "\(model.uniqueSignalCount)",
                systemImage: "number"
            )
            WorkspaceStatCard(
                label: LMText.filtered,
                value: "\(model.filteredEntries.count)",
                systemImage: "line.3.horizontal.decrease.circle"
            )
        }
    }
}

// MARK: - Tail body (loading / empty / error / success)

struct LiveTailBody: View {
    @Bindable var model: LiveSignalMonitorPageModel

    var body: some View {
        switch model.livePhase {
        case .loading:
            WorkspaceStateLoading(rows: 5, label: LMText.title)
        case .empty:
            WorkspaceStateEmpty(
                title: LMText.waiting,
                message: LMText.subtitle,
                systemImage: "dot.radiowaves.left.and.right"
            )
        case let .error(message):
            WorkspaceStateError(message: message) { model.retryLive() }
        case .success:
            successBody
        }
    }

    @ViewBuilder private var successBody: some View {
        if model.filteredEntries.isEmpty {
            WorkspaceStateEmpty(
                title: model.tailEmptyMessage,
                message: LMText.subtitle,
                systemImage: "waveform.path.ecg"
            )
        } else {
            LiveTailTable(entries: model.filteredEntries)
        }
    }
}

// MARK: - Scrolling table

struct LiveTailTable: View {
    let entries: [LiveTailEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            LiveTailHeaderRow()
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(entries) { entry in
                        LiveTailRow(entry: entry)
                        Divider()
                    }
                }
            }
            .frame(maxHeight: 420)
        }
        .accessibilityLabel(LMText.title)
    }
}

struct LiveTailHeaderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Text(LMText.time).frame(width: 96, alignment: .leading)
            Text(LMText.signal).frame(maxWidth: .infinity, alignment: .leading)
            Text(LMText.value).frame(width: 92, alignment: .trailing)
            Text(LMText.type).frame(width: 76, alignment: .leading)
            Text(LMText.freshness).frame(width: 84, alignment: .leading)
        }
        .font(.caption).fontWeight(.semibold)
        .foregroundStyle(.secondary)
        .padding(.vertical, 6)
        .accessibilityHidden(true)
    }
}

struct LiveTailRow: View {
    let entry: LiveTailEntry

    var body: some View {
        HStack(spacing: 12) {
            Text(entry.timestamp, format: .dateTime.hour().minute().second())
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 96, alignment: .leading)
            Text(entry.signal)
                .font(.system(.caption, design: .monospaced))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(entry.value.display)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(entry.value.typeTint)
                .lineLimit(1)
                .frame(width: 92, alignment: .trailing)
            LiveSignalTypeChip(value: entry.value)
                .frame(width: 76, alignment: .leading)
            LiveFreshnessIndicator(timestamp: entry.timestamp)
                .frame(width: 84, alignment: .leading)
        }
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.signal) \(entry.value.display)")
    }
}

// MARK: - Type chip + freshness

struct LiveSignalTypeChip: View {
    let value: WorkspaceSignalValue

    var body: some View {
        Text(value.typeLabel)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(value.typeTint.opacity(0.15), in: Capsule())
            .foregroundStyle(value.typeTint)
    }
}

/// Per-row freshness (web `FreshnessIndicator`): a colored dot keyed to sample
/// age plus the relative time. Turns amber past 30 s and red past the 2 min
/// staleness threshold (ADR-013).
struct LiveFreshnessIndicator: View {
    let timestamp: Date

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(tint).frame(width: 7, height: 7)
            Text(timestamp, format: .relative(presentation: .numeric, unitsStyle: .narrow))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityLabel("\(LMText.freshness): \(timestamp.formatted(.relative(presentation: .numeric)))")
    }

    private var tint: Color {
        let age = Date().timeIntervalSince(timestamp)
        if age > 120 { return .red }
        if age > 30 { return .orange }
        return .green
    }
}

// MARK: - Value-kind presentation (web SignalEntry.type + TYPE_VALUE_COLOR)

extension WorkspaceSignalValue {
    /// Web `entry.type` label: number / string / boolean.
    var typeLabel: String {
        switch self {
        case .number: "number"
        case .text: "string"
        case .bool: "boolean"
        case .missing: "—"
        }
    }

    /// Web `TYPE_VALUE_COLOR` accent (HIG-native semantic colors).
    var typeTint: Color {
        switch self {
        case .number: .cyan
        case .text: .green
        case .bool: .orange
        case .missing: .secondary
        }
    }
}
