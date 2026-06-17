//
//  StateMachineDebuggerPageLiveViews.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Live Region
//
//  GlassPanel3 of the debugger: the live controls (web `LiveControls`), the selectable state
//  timeline (web `StateTimeline`), and the snapshot inspector (web `SnapshotInspector`). The
//  controls toggle live-vs-frozen, step the selection, size the window, and clear the buffer; the
//  timeline lists the in-window transitions; the inspector shows the selected transition's
//  point-in-time signal snapshot (web `useSignalSnapshot`). Copy resolves from `Localizable.xcstrings`.
//

import SwiftUI

// MARK: - GlassPanel3 — live controls + timeline + inspector (web section 4b)

/// The live debugging panel composing the controls, the in-window state timeline, and the
/// selected-transition snapshot inspector.
struct FSMDebuggerLiveStatePanel: View {
    let model: StateMachineDebuggerPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                FSMDebuggerWindowControls(model: model)
                Divider().overlay(Color.TS.border)
                FSMDebuggerStateTimeline(model: model)
                Divider().overlay(Color.TS.border)
                FSMDebuggerSnapshotInspector(model: model)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Live controls (web LiveControls)

/// Live/frozen toggle, step prev/next, window-size menu, clear-buffer, and the in-window counter.
struct FSMDebuggerWindowControls: View {
    let model: StateMachineDebuggerPageModel

    private let windowOptions = [5, 10, 30, 60]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                liveToggle
                stepButtons
                windowMenu
                clearButton
                Spacer(minLength: TSSpacing.md)
                counter
            }
            .padding(.vertical, TSSpacing.xs)
        }
    }

    private var liveToggle: some View {
        Button { model.setLive(!model.isLive) } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: model.isLive ? "dot.radiowaves.left.and.right" : "pause.circle")
                Text(model.isLive ? "fsm.live" : "fsm.frozen")
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(model.isLive ? Color.TS.statusSuccess : Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
    }

    private var stepButtons: some View {
        HStack(spacing: TSSpacing.xs) {
            Button { model.stepPrev() } label: { Image(systemName: "chevron.left") }
                .buttonStyle(.plain)
                .disabled(!model.canStepPrev)
                .accessibilityLabel(Text("fsm.stepPrev"))
            Button { model.stepNext() } label: { Image(systemName: "chevron.right") }
                .buttonStyle(.plain)
                .disabled(!model.canStepNext)
                .accessibilityLabel(Text("fsm.stepNext"))
        }
        .foregroundStyle(Color.TS.accent)
    }

    private var windowMenu: some View {
        Menu {
            ForEach(windowOptions, id: \.self) { minutes in
                Button { model.windowChanged(to: minutes) } label: { Text(verbatim: "\(minutes)m") }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                TSLabel("fsm.window")
                Text(verbatim: "\(model.windowMinutes)m").font(Font.TS.bodySm)
            }
            .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var clearButton: some View {
        Button { model.clearBuffer() } label: { Image(systemName: "xmark.circle") }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text("fsm.clearBuffer"))
    }

    private var counter: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: "\(model.windowedTransitions.count) / \(model.transitions.count)")
                .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
            TSCaption("fsm.inWindow")
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - State timeline (web StateTimeline)

/// The selectable list of in-window transitions; tapping a row freezes the stream and selects it.
struct FSMDebuggerStateTimeline: View {
    let model: StateMachineDebuggerPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSubhead("fsm.stateTimeline")
            if model.windowedTransitions.isEmpty {
                TSEmptyState(title: LocalizedStringKey(model.emptyRangeMessage), systemImage: "clock")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.md)
            } else {
                ForEach(model.windowedTransitions) { transition in
                    FSMDebuggerTimelineRow(
                        transition: transition,
                        isSelected: transition.id == model.selectedID
                    ) { model.toggleSelect(transition.id) }
                }
            }
        }
    }
}

/// One selectable timeline row: time · from → to · trigger.
struct FSMDebuggerTimelineRow: View {
    let transition: FSMDebuggerTransition
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: StateMachineFormat.time(transition.ts))
                    .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
                FSMDebuggerStateBadge(state: transition.fromState)
                Image(systemName: "arrow.right").font(.caption2).foregroundStyle(Color.TS.textMuted)
                FSMDebuggerStateBadge(state: transition.toState)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: transition.trigger)
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary).lineLimit(1)
            }
            .padding(.vertical, TSSpacing.xs)
            .padding(.horizontal, TSSpacing.sm)
            .background(
                isSelected ? Color.TS.accent.opacity(0.12) : Color.clear,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Snapshot inspector (web SnapshotInspector)

/// The selected transition's point-in-time signal snapshot, with loading + unselected states.
struct FSMDebuggerSnapshotInspector: View {
    let model: StateMachineDebuggerPageModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSubhead("fsm.snapshotInspector")
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if model.snapshotLoading {
            TSSpinner(label: "loading").padding(.vertical, TSSpacing.sm)
        } else if model.snapshot.isEmpty {
            TSEmptyState(title: "fsm.noSnapshot", systemImage: "scope")
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.md)
        } else {
            TSKVList(rows: model.snapshot.map {
                TSKVRow(id: $0.id, key: LocalizedStringKey($0.name), value: $0.value)
            })
        }
    }
}
