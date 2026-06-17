//
//  StateMachineDebuggerPageSections.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Panel Sections
//
//  The token-styled panels of the debugger: the FSM-type / per-page filters (web GlassPanel1),
//  the live vehicle-state hero (web GlassPanel2), the four summary stat cards (web Transitions-
//  Page / Total-Transitions / Flap-Warnings / Current-State), the FSM health indicators, and the
//  active sub-FSM list. Every visible literal resolves from `Localizable.xcstrings`; chrome uses
//  the P2 tokens (ADR-005/014). Adaptive macOS (regular) / iPhone (compact) via the injected flag.
//

import SwiftUI

// MARK: - GlassPanel1 — FSM-type + per-page filters (web section 1)

/// The page-specific filters panel: the FSM-type select (with its help affordance) and the
/// per-page select, or the no-vehicles empty state when none are available.
struct FSMDebuggerFiltersPanel: View {
    let model: StateMachineDebuggerPageModel
    let isCompact: Bool

    private var fsmTypeBinding: Binding<FSMTypeFilter> {
        Binding(get: { model.fsmType }, set: { type in Task { await model.fsmTypeChanged(to: type) } })
    }

    private var perPageBinding: Binding<Int> {
        Binding(get: { model.perPage }, set: { size in Task { await model.perPageChanged(to: size) } })
    }

    var body: some View {
        TSGlassPanel {
            if model.vehicles.isEmpty {
                TSEmptyState(title: "fsm.noVehicles", systemImage: "car.2")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, TSSpacing.lg)
            } else {
                fields
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var fields: some View {
        let layout = isCompact
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TSSpacing.md))
            : AnyLayout(HStackLayout(alignment: .bottom, spacing: TSSpacing.md))
        layout {
            fsmTypeField
            perPageField
        }
    }

    private var fsmTypeField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                TSLabel("fsm.fsmType")
                TSHelpTooltip("help.fsm.type.aria")
            }
            TSSelect(
                selection: fsmTypeBinding,
                options: FSMTypeFilter.allCases.map { TSSelectOption($0, $0.titleKey) }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var perPageField: some View {
        TSSelect(
            selection: perPageBinding,
            options: StateMachineDebuggerPageModel.perPageOptions.map {
                TSSelectOption($0, LocalizedStringKey("\($0)"))
            },
            label: "fsm.perPage"
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - GlassPanel2 — Vehicle live state hero (web section 3)

/// The current FSM-resolved vehicle state (web "Vehicle Live State"): a large tone-tinted state
/// chip beside the type / mode / since readouts, with a staleness flag (ADR-013), or the
/// no-state empty state.
struct FSMDebuggerCurrentStatePanel: View {
    let model: StateMachineDebuggerPageModel
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if let state = model.currentState {
                    content(state)
                } else {
                    TSEmptyState(title: "fsm.noState", systemImage: "questionmark.circle")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TSSpacing.md)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            TSLabel("fsm.vehicleLiveState")
            TSHelpTooltip("help.fsm.liveState.aria")
            if model.isLiveStale {
                TSBadge("fsm.stale", tone: .warning)
            }
        }
    }

    @ViewBuilder
    private func content(_ state: VehicleLiveState) -> some View {
        let layout = isCompact
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TSSpacing.lg))
            : AnyLayout(HStackLayout(alignment: .center, spacing: TSSpacing.x2xl))
        layout {
            heroChip(state)
            infoColumn(state)
        }
    }

    private func heroChip(_ state: VehicleLiveState) -> some View {
        let tone = StateMachineFormat.stateTone(state.state)
        return HStack(spacing: TSSpacing.sm) {
            Circle().fill(tone.color).frame(width: 12, height: 12)
            Text(verbatim: state.state.uppercased())
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(tone.color)
        }
        .padding(.horizontal, TSSpacing.xl)
        .padding(.vertical, TSSpacing.md)
        .background(tone.color.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: state.state))
    }

    private func infoColumn(_ state: VehicleLiveState) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FSMDebuggerInlineFact(labelKey: "fsm.type", valueKey: "fsm.typeVehicle")
            FSMDebuggerInlineFact(labelKey: "fsm.mode", valueKey: StateMachineFormat.modeKey(for: state))
            if let since = state.since {
                FSMDebuggerInlineFact(labelKey: "fsm.since", value: StateMachineFormat.absolute(since))
                TSCaption(LocalizedStringKey(StateMachineFormat.relative(since)))
            }
        }
    }
}

/// A "label: value" fact line for the live-state column (value is a key or a verbatim string).
struct FSMDebuggerInlineFact: View {
    let labelKey: LocalizedStringKey
    private let valueKey: LocalizedStringKey?
    private let value: String?

    init(labelKey: LocalizedStringKey, valueKey: LocalizedStringKey) {
        self.labelKey = labelKey
        self.valueKey = valueKey
        value = nil
    }

    init(labelKey: LocalizedStringKey, value: String) {
        self.labelKey = labelKey
        valueKey = nil
        self.value = value
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(labelKey).font(Font.TS.bodySm).foregroundStyle(Color.TS.textMuted)
            valueText.font(Font.TS.bodySm).fontWeight(.medium).foregroundStyle(Color.TS.textPrimary)
        }
    }

    @ViewBuilder
    private var valueText: some View {
        if let valueKey {
            Text(valueKey)
        } else {
            Text(verbatim: value ?? StateMachineFormat.emptyValue)
        }
    }
}

// MARK: - Summary stat cards (web section 7: Transitions-Page / Total / Flap / Current)

/// The four headline summary cards bound to the model's totals (web `StatCard` grid).
struct FSMDebuggerSummaryCards: View {
    let model: StateMachineDebuggerPageModel
    let columns: Int

    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columns)
    }

    private var onPageOverTotal: String {
        let onPage = StateMachineFormat.integer(model.transitions.count)
        let total = StateMachineFormat.integer(model.totalRows)
        return "\(onPage) / \(total)"
    }

    var body: some View {
        LazyVGrid(columns: gridColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "fsm.totalOnPage",
                value: onPageOverTotal,
                systemImage: "waveform.path.ecg"
            )
            TSStatCard(
                title: "fsm.totalTransitions",
                value: StateMachineFormat.integer(model.totalRows),
                systemImage: "waveform.path.ecg"
            )
            TSStatCard(
                title: "fsm.flapCount",
                value: StateMachineFormat.integer(model.flapIDs.count),
                systemImage: "exclamationmark.triangle"
            )
            TSStatCard(
                title: "fsm.currentState",
                value: model.stateName ?? StateMachineFormat.emptyValue,
                systemImage: "bolt.fill"
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - FSM health indicators (web FSMHealthPanel)

/// Health summary derived from the transition list: a flap-warning banner when same-FSM bursts
/// are detected, over compact total / flap / average-interval tiles.
struct FSMDebuggerHealthPanel: View {
    let transitions: [FSMDebuggerTransition]
    let flapCount: Int

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "heart.text.square")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("fsm.healthTitle")
                }
                if flapCount > 0 {
                    flapBanner
                }
                tiles
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var flapBanner: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusWarning)
            Text(verbatim: StateMachineFormat.flappingMessage(count: flapCount))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }

    private var tiles: some View {
        let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md)]
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            FSMDebuggerHealthTile(value: StateMachineFormat.integer(transitions.count), label: "fsm.totalTransitions")
            FSMDebuggerHealthTile(value: StateMachineFormat.integer(flapCount), label: "fsm.flapCount")
            FSMDebuggerHealthTile(value: avgGap, label: "fsm.avgInterval")
        }
    }

    private var avgGap: String {
        let gap = StateMachineDerive.overallAvgIntervalSec(from: transitions)
        return gap > 0 ? StateMachineFormat.duration(gap) : StateMachineFormat.emptyValue
    }
}

/// One health metric tile (centered value + caption).
struct FSMDebuggerHealthTile: View {
    let value: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.panel)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
            TSCaption(label)
        }
        .frame(maxWidth: .infinity)
        .multilineTextAlignment(.center)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Active sub-FSMs (web FSMSubFSMPanel)

/// The active sub-FSM list (drive / charge lifecycles) from `FSMStats.activeSubs`, or the empty
/// state when none are running.
struct FSMDebuggerSubFSMPanel: View {
    let subs: [ActiveSubFSM]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSPanelTitle("fsm.subFsmTitle")
                }
                if subs.isEmpty {
                    TSEmptyState(title: "fsm.noActiveSubs", systemImage: "moon.zzz")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, TSSpacing.md)
                } else {
                    ForEach(subs) { sub in FSMDebuggerSubFSMRow(sub: sub) }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One active sub-FSM row: type chip + state + started-relative.
struct FSMDebuggerSubFSMRow: View {
    let sub: ActiveSubFSM

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: sub.type == "charge" ? "bolt.fill" : "car.fill")
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            FSMDebuggerStateBadge(state: sub.state)
            Spacer(minLength: TSSpacing.sm)
            if let start = sub.startTime {
                TSCaption(LocalizedStringKey(StateMachineFormat.relative(start)))
            }
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}
