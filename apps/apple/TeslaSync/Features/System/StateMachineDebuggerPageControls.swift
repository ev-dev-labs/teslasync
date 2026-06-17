//
//  StateMachineDebuggerPageControls.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Shared Controls
//
//  Small shared chrome for the debugger: the header range menu (web `RangePicker`), the
//  share-permalink button (web `CopyButton`), the FSM state chip (web `StateBadge`), and the
//  page-level loading + error states (web `PageContainer` loading / error). All copy resolves
//  from `Localizable.xcstrings`; chrome uses the P2 design tokens (ADR-005/014).
//

import SwiftUI

// MARK: - Range menu (web `RangePicker`)

/// The trailing range selector in the header. A native `Menu` over the `RangePreset` set; a pick
/// re-queries the transition window through the model.
struct FSMDebuggerRangeMenu: View {
    let model: StateMachineDebuggerPageModel

    private var binding: Binding<RangePreset> {
        Binding(
            get: { model.rangePreset },
            set: { preset in Task { await model.rangeChanged(to: preset) } }
        )
    }

    var body: some View {
        Menu {
            Picker(selection: binding) {
                ForEach(RangePreset.allCases) { preset in
                    Text(preset.titleKey).tag(preset)
                }
            } label: {
                EmptyView()
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                Text(model.rangePreset.titleKey)
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityLabel(Text("fsm.since"))
    }
}

// MARK: - Share button (web `CopyButton` label="Share permalink")

/// Copies a deep link to the current debugger selection, with a transient confirmation.
struct FSMDebuggerShareButton: View {
    let permalink: String
    @State private var copied = false

    var body: some View {
        Button(action: copy) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: copied ? "checkmark" : "square.and.arrow.up")
                Text("debugger.share")
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(copied ? Color.TS.statusSuccess : Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("debugger.share"))
    }

    private func copy() {
        TSClipboard.copy(permalink)
        copied = true
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

// MARK: - State chip (web `StateBadge`)

/// A colored state pill (web `StateBadge`): a tone-tinted dot + the verbatim state name. The tone
/// derives from the FSM badge-variant map so light/dark/high-contrast all resolve from tokens.
struct FSMDebuggerStateBadge: View {
    let state: String

    private var tone: TSTone { StateMachineFormat.stateTone(state) }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: state)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tone.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: state))
    }
}

// MARK: - Loading (web PageContainer `loading`)

/// The page-level loading skeleton: filter, stat grid, chart, and table skeletons standing in for
/// the populated sections while the four reads resolve.
struct FSMDebuggerLoadingView: View {
    let columns: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSGlassPanel { TSTableSkeleton(rows: 2) }
            TSStatGridSkeleton(count: 4)
            TSGlassPanel { TSChartSkeleton(height: 220) }
            TSGlassPanel { TSTableSkeleton(rows: 6) }
        }
        .accessibilityLabel(Text("loading"))
    }
}

// MARK: - Error (web PageContainer `error`)

/// The retryable error state (web `PageContainer` error): the failure message + a Retry action.
struct FSMDebuggerErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: onRetry)
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }
}
