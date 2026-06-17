//
//  StateMachineDebuggerPageTransitionViews.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple) — Log & Detail
//
//  GlassPanel10 (the paginated transition log, web "Transition Log" `DataTable` + `Pagination`)
//  and GlassPanel11 (the selected-transition detail, web "Transition Detail"). The log binds the
//  server-paged transitions through the `@Observable` model; the detail panel renders the selected
//  row's fields. Every visible literal resolves from `Localizable.xcstrings`; chrome uses the P2
//  tokens (ADR-005/014). Adaptive macOS (table) / iPhone (card list) via `TSDataTable`.
//

import SwiftUI

// MARK: - GlassPanel10 — Transition Log (web section 9)

/// The paginated transition log table (web "Transition Log"): index, time, FSM, from/to chips,
/// trigger, and a per-row detail toggle, with the server pager — or the range-aware empty state.
struct FSMDebuggerLogPanel: View {
    let model: StateMachineDebuggerPageModel
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.transitions.isEmpty {
                    TSEmptyState(
                        title: LocalizedStringKey(model.emptyRangeMessage),
                        systemImage: "list.bullet.rectangle"
                    )
                    .frame(maxWidth: .infinity, minHeight: 160)
                } else {
                    TSDataTable(rows: model.transitions, columns: columns, density: .compact)
                    pager
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            TSPanelTitle("fsm.timelineTitle")
            if model.totalRows > 0 {
                Text(verbatim: StateMachineFormat.integer(model.totalRows))
                    .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
                Text("fsm.total").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
    }

    private var pager: some View {
        HStack {
            Spacer()
            TSPagination(currentPage: pageBinding, pageCount: model.pageCount)
        }
    }

    private var pageBinding: Binding<Int> {
        Binding(
            get: { model.serverPage - 1 },
            set: { zeroBased in Task { await model.pageChanged(to: zeroBased) } }
        )
    }

    private var columns: [TSColumn<FSMDebuggerTransition>] {
        [
            TSColumn(id: "index", title: "fsm.indexColumn") { row in
                Text(verbatim: StateMachineFormat.integer(globalIndex(of: row)))
                    .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textMuted)
            },
            TSColumn(id: "time", title: "fsm.time") { row in
                Text(verbatim: StateMachineFormat.absolute(row.ts)).font(Font.TS.caption).monospacedDigit()
            },
            TSColumn(id: "fsm", title: "fsm.type") { row in
                Text(verbatim: row.displayFSMName).font(Font.TS.caption)
            },
            TSColumn(id: "from", title: "fsm.from") { row in FSMDebuggerStateBadge(state: row.fromState) },
            TSColumn(id: "to", title: "fsm.to") { row in FSMDebuggerStateBadge(state: row.toState) },
            TSColumn(id: "trigger", title: "fsm.trigger") { row in
                Text(verbatim: row.trigger).font(Font.TS.caption)
            },
            TSColumn(id: "detail", title: "fsm.viewDetail") { row in detailToggle(row) }
        ]
    }

    private func detailToggle(_ row: FSMDebuggerTransition) -> some View {
        Button { model.toggleSelect(row.id) } label: {
            Image(systemName: model.selectedID == row.id ? "chevron.down" : "chevron.right")
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("fsm.viewDetail"))
    }

    /// Web global index: `(serverPage - 1) * perPage + rowIndex + 1`.
    private func globalIndex(of row: FSMDebuggerTransition) -> Int {
        let rowIndex = model.transitions.firstIndex(of: row) ?? 0
        return (model.serverPage - 1) * model.perPage + rowIndex + 1
    }
}

// MARK: - GlassPanel11 — Transition Detail (web section 10)

/// The selected-transition detail card (web "Transition Detail"): id / vehicle / fsm / from / to /
/// trigger / guard / duration scalar fields, the absolute + relative timestamp, and the raw
/// details key/value list.
struct FSMDebuggerDetailPanel: View {
    let transition: FSMDebuggerTransition

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .topLeading)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("fsm.detailTitle")
                scalarGrid
                timestampField
                if !transition.details.isEmpty { contextField }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var scalarGrid: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            FSMDebuggerDetailField(labelKey: "fsm.detail.id") { TSCode("\(transition.id)") }
            FSMDebuggerDetailField(labelKey: "fsm.detail.vehicleId") { TSCode("\(transition.vehicleID)") }
            if !transition.fsmName.isEmpty {
                FSMDebuggerDetailField(labelKey: "fsm.detail.name") { TSCode(transition.fsmName) }
            }
            FSMDebuggerDetailField(labelKey: "fsm.detail.from") { FSMDebuggerStateBadge(state: transition.fromState) }
            FSMDebuggerDetailField(labelKey: "fsm.detail.to") { FSMDebuggerStateBadge(state: transition.toState) }
            FSMDebuggerDetailField(labelKey: "fsm.detail.trigger") { TSCode(transition.trigger) }
            if let guardName = transition.guardName, !guardName.isEmpty {
                FSMDebuggerDetailField(labelKey: "fsm.detail.guard") { TSCode(guardName) }
            }
            if let duration = transition.durationInStateMs, duration > 0 {
                FSMDebuggerDetailField(labelKey: "fsm.detail.duration") {
                    TSCode(StateMachineFormat.duration(duration / 1000))
                }
            }
        }
    }

    private var timestampField: some View {
        FSMDebuggerDetailField(labelKey: "fsm.detail.timestamp") {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: StateMachineFormat.absolute(transition.ts))
                    .font(Font.TS.caption).monospacedDigit().foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: StateMachineFormat.relative(transition.ts))
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private var contextField: some View {
        FSMDebuggerDetailField(labelKey: "fsm.detail.context") {
            TSKVList(rows: transition.details.map {
                TSKVRow(id: $0.key, key: LocalizedStringKey($0.key), value: $0.value)
            })
        }
    }
}

/// One labeled detail field: a muted caption over caller-provided value content.
struct FSMDebuggerDetailField<Content: View>: View {
    let labelKey: LocalizedStringKey
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption(labelKey)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
