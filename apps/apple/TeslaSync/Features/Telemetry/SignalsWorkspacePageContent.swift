//
//  SignalsWorkspacePageContent.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  Panel 10 (GlassPanel10): the two-snapshot compare diff table with bulk
//  actions and pinned badges. Renders the useSignalDiffServer data states and
//  drives the useTogglePin mutation.
//

import SwiftUI

// MARK: - Clipboard (cross-platform)

enum WorkspaceClipboard {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }
}

// MARK: - Source layer badge

/// Coloured chip for the signal-store layer a value resolved from (L1/L2/LOG/STALE).
struct SourceBadge: View {
    let source: String

    var body: some View {
        Text(source)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
            .accessibilityLabel("Source \(source)")
    }

    private var color: Color {
        switch source.uppercased() {
        case "L1": .green
        case "L2": .cyan
        case "LOG": .blue
        case "STALE": .orange
        default: .secondary
        }
    }
}

// MARK: - Diff row

struct DiffRow: View {
    @Bindable var model: SignalsWorkspacePageModel
    let row: WorkspaceDiffEntry
    let isSelected: Bool
    let onToggleSelect: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            selectButton
            pinButton
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name).font(.system(.body, design: .monospaced)).lineLimit(1)
                valuesLine
            }
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                if let sourceA = row.sourceA { SourceBadge(source: sourceA) }
                if let sourceB = row.sourceB { SourceBadge(source: sourceB) }
            }
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var selectButton: some View {
        Button(action: onToggleSelect) {
            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isSelected ? "Deselect \(row.name)" : "Select \(row.name)")
    }

    private var pinButton: some View {
        Button {
            Task { await model.togglePin(row.name) }
        } label: {
            Image(systemName: model.isPinned(row.name) ? "pin.fill" : "pin")
                .foregroundStyle(model.isPinned(row.name) ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.isPinned(row.name) ? "Unpin \(row.name)" : "Pin \(row.name)")
    }

    private var valuesLine: some View {
        HStack(spacing: 6) {
            Text(row.valueA.display).foregroundStyle(.secondary)
            Image(systemName: "arrow.right").font(.caption2).foregroundStyle(.secondary)
            Text(row.valueB.display)
            deltaView
        }
        .font(.system(.caption, design: .monospaced))
    }

    @ViewBuilder private var deltaView: some View {
        if let delta = row.delta {
            HStack(spacing: 2) {
                Image(systemName: delta > 0 ? "arrow.up" : delta < 0 ? "arrow.down" : "minus")
                Text(String(format: "%+.3f", delta))
            }
            .foregroundStyle(delta > 0 ? .green : delta < 0 ? .red : .secondary)
        }
    }
}

// MARK: - Panel 10 · Compare diff panel (GlassPanel10)

struct CompareDiffPanel: View {
    @Bindable var model: SignalsWorkspacePageModel
    @State private var selection: Set<String> = []

    var body: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 14) {
                if !selection.isEmpty { bulkToolbar }
                diffBody
                if model.pinnedCount > 0 { pinnedFooter }
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private var diffBody: some View {
        switch model.diffPhase {
        case .loading:
            WorkspaceStateLoading(rows: 6, label: WSText.totalChanged)
        case .empty:
            WorkspaceStateEmpty(
                title: WSText.noChanges,
                message: WSText.windowSpan,
                systemImage: "arrow.left.arrow.right"
            )
        case let .error(message):
            WorkspaceStateError(message: message) { Task { await model.retryDiff() } }
        case .success:
            diffList
        }
    }

    @ViewBuilder private var diffList: some View {
        if model.visibleDiffRows.isEmpty {
            WorkspaceStateEmpty(
                title: WSText.noChanges,
                message: WSText.visibleAfterFilter,
                systemImage: "line.3.horizontal.decrease.circle"
            )
        } else {
            LazyVStack(alignment: .leading, spacing: 2) {
                ForEach(model.visibleDiffRows) { row in
                    DiffRow(
                        model: model,
                        row: row,
                        isSelected: selection.contains(row.name),
                        onToggleSelect: { toggle(row.name) }
                    )
                    Divider()
                }
            }
        }
    }

    private var bulkToolbar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { bulkButtons }
            VStack(alignment: .leading, spacing: 8) { bulkButtons }
        }
        .padding(8)
        .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    @ViewBuilder private var bulkButtons: some View {
        Text("\(selection.count)").font(.caption).foregroundStyle(.secondary)
        Button(WSText.bulkPin, systemImage: "pin") {
            Task { await model.pinSelected(Array(selection)) }
        }
        .buttonStyle(.bordered).controlSize(.small)
        Button(WSText.bulkUnpin, systemImage: "pin.slash") {
            Task { await model.unpinSelected(Array(selection)) }
        }
        .buttonStyle(.bordered).controlSize(.small)
        Button(WSText.bulkCsv, systemImage: "doc.text") {
            WorkspaceClipboard.copy(model.exportDiffCSV())
        }
        .buttonStyle(.bordered).controlSize(.small)
        Button(WSText.bulkAddAlert, systemImage: "bell") {
            WorkspaceClipboard.copy(selection.sorted().joined(separator: ","))
        }
        .buttonStyle(.bordered).controlSize(.small)
        Button("Clear", systemImage: "xmark.circle") { selection.removeAll() }
            .buttonStyle(.bordered).controlSize(.small).labelStyle(.iconOnly)
    }

    private var pinnedFooter: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            Text(WSText.pinnedLabel).font(.caption).foregroundStyle(.secondary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.pinnedSignalNames, id: \.self) { name in
                        Label(name, systemImage: "pin.fill")
                            .font(.caption2)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(.tint.opacity(0.15), in: Capsule())
                    }
                }
            }
        }
    }

    private func toggle(_ name: String) {
        if selection.contains(name) { selection.remove(name) } else { selection.insert(name) }
    }
}
