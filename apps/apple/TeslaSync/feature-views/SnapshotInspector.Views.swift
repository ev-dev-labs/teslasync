//
//  SnapshotInspector.Views.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The presentational subviews of the snapshot detail (web render body when a transition
//  is selected): the title + copy-snapshot affordance, the from/to/trigger/duration meta
//  grid, the inlined `StateBadge` port, the diff-mode toggle, and the scrollable list of
//  signal rows each carrying the inlined `SourceLayerBadge`. All copy resolves through the
//  P1/S10 facade and all chrome is token-driven (P1/S9); no networking, no Tailwind ports.
//
//  The web `StateBadge` resolves its colour through `getStateColor(fsmType, state)`; the
//  native parity reuses the shared `FSMRegistry.color(for:state:)` registry port (the same
//  seam the FSM state diagram binds through) so the two never drift. The web
//  `SourceLayerBadge` has no shared native counterpart, so its tiny glyph + tooltip is
//  reproduced here, tinted per layer and described through the P1/S10 facade.
//

import SwiftUI

// MARK: - Snapshot detail (web render body for a selected transition)

/// The populated snapshot detail — the title row, the meta grid, the signals header with
/// the diff toggle, and the signal rows (or the "no signals" empty). Mirrors the web
/// `space-y-4` column.
struct SnapshotInspectorDetail: View {
    let content: SnapshotInspectorContent
    @Binding var diffMode: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            titleRow
            metaGrid
            signalsHeader
            signalsBody
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    // MARK: Title + copy

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline) {
            panelTitle("debugger.inspector.title", "Transition snapshot")
            Spacer(minLength: TSSpacing.sm)
            if !content.copyPayload.isEmpty {
                SnapshotInspectorCopyButton(payload: content.copyPayload)
            }
        }
    }

    // MARK: Meta grid (web `grid-cols-2 sm:grid-cols-4`)

    private var metaGrid: some View {
        let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .topLeading)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            metaCell(key: "debugger.inspector.from", fallback: "From") {
                SnapshotInspectorStateBadge(state: content.fromState, fsmType: content.fsmType)
            }
            metaCell(key: "debugger.inspector.to", fallback: "To") {
                SnapshotInspectorStateBadge(state: content.toState, fsmType: content.fsmType)
            }
            metaCell(key: "debugger.inspector.trigger", fallback: "Trigger") {
                Text(verbatim: content.triggerText)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(2)
            }
            metaCell(key: "debugger.inspector.duration", fallback: "Duration") {
                Text(verbatim: content.durationText)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
            }
        }
    }

    private func metaCell(
        key: String,
        fallback: String,
        @ViewBuilder value: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: SnapshotInspectorStrings.string(key, fallback))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            value()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: Signals header (title + diff toggle)

    private var signalsHeader: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            HStack {
                panelTitle("debugger.inspector.signalsTitle", "Signals at transition")
                Spacer(minLength: TSSpacing.sm)
                diffToggle
            }
        }
    }

    private func panelTitle(_ key: String, _ fallback: String) -> some View {
        Text(verbatim: SnapshotInspectorStrings.string(key, fallback))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityAddTraits(.isHeader)
    }

    private var diffToggle: some View {
        Toggle(isOn: $diffMode) {
            Text(verbatim: SnapshotInspectorStrings.string("debugger.inspector.diffMode", "Diff vs previous"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .toggleStyle(.switch)
        .controlSize(.small)
        .tint(Color.TS.accent)
        .fixedSize()
        .accessibilityLabel(Text(verbatim: SnapshotInspectorStrings.string(
            "debugger.inspector.diffMode", "Diff vs previous"
        )))
    }

    // MARK: Signals body (rows or the "no signals" empty)

    @ViewBuilder
    private var signalsBody: some View {
        if content.rows.isEmpty {
            SnapshotInspectorNoSignals()
        } else {
            ScrollView {
                VStack(spacing: TSSpacing.xs) {
                    ForEach(content.rows) { row in
                        SnapshotInspectorSignalRowView(row: row, diffMode: diffMode)
                    }
                }
            }
            .frame(maxHeight: 480)
        }
    }
}

// MARK: - Copy snapshot (web `CopyButton`)

/// The copy-to-clipboard affordance — the native parity of the web
/// `<CopyButton text={copyPayload} label="Copy snapshot" />`, with a transient checkmark.
struct SnapshotInspectorCopyButton: View {
    let payload: String
    @State private var didCopy = false

    var body: some View {
        Button {
            TSClipboard.copy(payload)
            didCopy = true
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                didCopy = false
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: copyLabel)
                    .font(Font.TS.caption)
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: copyLabel))
    }

    private var copyLabel: String {
        SnapshotInspectorStrings.string("debugger.inspector.copy", "Copy snapshot")
    }
}

// MARK: - State badge (web sibling `StateBadge.tsx`, inlined)

/// The inlined parity of the web `StateBadge` — a tinted pill with a leading coloured dot
/// and the raw (system-valued, unlocalised) state text, coloured via the shared
/// `FSMRegistry` port of `getStateColor`.
struct SnapshotInspectorStateBadge: View {
    let state: String
    let fsmType: String

    private var tint: Color {
        FSMRegistry.color(for: fsmType, state: state).tint
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
            Text(verbatim: state)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tint)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tint.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tint.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: state))
    }
}

// MARK: - Signal row (web `<li>` value row)

/// One signal row — the monospaced name, the formatted value, the struck-through prior
/// value in diff mode, and the trailing source-layer badge. Highlighted (amber) when the
/// value changed and dimmed when unchanged, mirroring the web diff visual language.
struct SnapshotInspectorSignalRowView: View {
    let row: SnapshotInspectorSignalRow
    let diffMode: Bool

    private var dimmed: Bool {
        diffMode && !row.changed
    }

    private var highlighted: Bool {
        diffMode && row.changed
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: row.name)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(verbatim: row.valueDisplay)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                if diffMode, row.changed, let previous = row.previousDisplay {
                    Text(verbatim: previous)
                        .font(.system(size: 10))
                        .foregroundStyle(Color.TS.textMuted)
                        .strikethrough()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            SnapshotInspectorSourceBadge(source: row.source, ageMs: row.ageMs)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs + 2)
        .background(rowFill, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(rowBorder, lineWidth: 1)
        )
        .opacity(dimmed ? 0.4 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SnapshotInspectorAccessibility.rowLabel(
            row, localize: SnapshotInspectorStrings.string
        )))
    }

    private var rowFill: Color {
        highlighted ? Color.TS.statusWarning.opacity(0.08) : Color.TS.surfaceGlass
    }

    private var rowBorder: Color {
        highlighted ? Color.TS.statusWarning.opacity(0.3) : Color.TS.border
    }
}

// MARK: - Source-layer badge (web `SourceLayerBadge`, inlined)

/// The inlined parity of the web `SourceLayerBadge` — a tiny monospaced glyph tinted per
/// layer (L1 hot / L2 cross-pod / LOG replay / STALE) with the layer description (and the
/// signal age, when known) surfaced through `.help` + the VoiceOver label.
struct SnapshotInspectorSourceBadge: View {
    let source: SignalSourceLayer?
    let ageMs: Double?

    private var layer: SignalSourceLayer {
        source ?? .unknown
    }

    var body: some View {
        Text(verbatim: layer.badgeLabel)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .tracking(0.5)
            .foregroundStyle(tint)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(tint.opacity(0.15), in: RoundedRectangle(cornerRadius: 4, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(tint.opacity(0.3), lineWidth: 1)
            )
            .help(tooltip)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: tooltip))
    }

    private var tint: Color {
        switch layer {
        case .l1: Color.TS.statusSuccess
        case .l2: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .log, .unknown: Color.TS.textMuted
        }
    }

    private var tooltip: String {
        let description = SnapshotInspectorStrings.string(layer.descriptionKey, layer.descriptionFallback)
        guard let age = SnapshotAge.format(ageMs) else { return description }
        let ageWord = SnapshotInspectorStrings.string("sourceLayer.age", "age")
        return "\(description) (\(ageWord): \(age))"
    }
}

// MARK: - Localization Text helper

extension SnapshotInspectorStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
