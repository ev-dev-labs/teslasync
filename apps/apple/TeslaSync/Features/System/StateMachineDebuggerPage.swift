//
//  StateMachineDebuggerPage.swift
//  TeslaSync — P4 feature view · P7 · system/StateMachineDebugger (Apple)
//
//  Native SwiftUI parity of `web/src/features/system/pages/StateMachineDebuggerPage.tsx`
//  (route `/state-debugger`): the multi-FSM transition debugger. Reproduces the web
//  `PageContainer` chrome (title + subtitle + page-level loading/error), the header actions
//  (vehicle `Select`, the range picker, the live auto-refresh indicator, and the share-permalink
//  button), and every section: the FSM-type/per-page filters, health indicators, the live
//  vehicle-state hero, active sub-FSMs, the live controls + state timeline + snapshot inspector,
//  the state diagram, the distribution donut + transition-counts table, the four summary cards,
//  the transition-timeline chart, the paginated transition log, and the selected-transition
//  detail. Data binds through the `@Observable` `StateMachineDebuggerPageModel` (no networking in
//  the view, ADR-004); copy resolves from `Localizable.xcstrings` (ADR-014); chrome uses the P2
//  tokens (ADR-005). Adaptive across macOS (regular) and iPhone (compact) per ADR-002/006.
//

import SwiftUI

public struct StateMachineDebuggerPage: View {
    @State private var model: StateMachineDebuggerPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: StateMachineDebuggerPageModel = StateMachineDebuggerPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("fsm.title"))
        .task {
            switch model.state {
            case .loaded, .empty: return
            default: await model.load()
            }
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: Header (web PageContainer title + subtitle + actions)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("fsm.title")
                Text("fsm.subtitle")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .accessibilityElement(children: .combine)

            actions
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var actions: some View {
        let layout = isCompact
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: TSSpacing.sm))
            : AnyLayout(HStackLayout(alignment: .center, spacing: TSSpacing.md))
        layout {
            if !model.vehicles.isEmpty {
                vehiclePicker
            }
            FSMDebuggerRangeMenu(model: model)
            if !isCompact { Spacer(minLength: 0) }
            autoRefreshIndicator
            FSMDebuggerShareButton(permalink: permalink)
        }
    }

    private var vehiclePicker: some View {
        TSVehicleSelect(
            selection: vehicleBinding,
            vehicles: model.vehicles.map {
                TSVehicleOption(id: "\($0.id)", name: LocalizedStringKey($0.label), nameText: $0.label)
            }
        )
        .frame(maxWidth: isCompact ? .infinity : 220)
        .accessibilityLabel(Text("fsm.selectVehicle"))
    }

    private var autoRefreshIndicator: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.caption2)
            Text("fsm.autoRefresh")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .combine)
    }

    // MARK: State router (web PageContainer loading / error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            FSMDebuggerLoadingView(columns: isCompact ? 2 : 4)
        case let .error(message):
            FSMDebuggerErrorView(message: message) {
                Task { await model.refresh() }
            }
        case .empty, .loaded:
            FSMDebuggerBody(model: model, isCompact: isCompact)
        }
    }

    // MARK: Bindings + permalink

    private var vehicleBinding: Binding<String?> {
        Binding(
            get: { model.selectedVehicleStringID },
            set: { newValue in
                let id = newValue.flatMap(Int64.init)
                Task { await model.vehicleChanged(to: id) }
            }
        )
    }

    /// Web `permalinkUrl` — a native deep link carrying the current selection.
    private var permalink: String {
        var parts = ["teslasync://state-debugger"]
        var query: [String] = []
        if let id = model.selectedVehicleID { query.append("vehicle_id=\(id)") }
        if model.fsmType != .all { query.append("fsm=\(model.fsmType.rawValue)") }
        if let selected = model.selectedID { query.append("selected=\(selected)") }
        if !query.isEmpty { parts.append("?" + query.joined(separator: "&")) }
        return parts.joined()
    }
}

// MARK: - Populated body (web section stack)

/// Composes every populated-state section in the web render order, each fading in. Split out of
/// the page so the scaffold stays under the body-length budget.
struct FSMDebuggerBody: View {
    let model: StateMachineDebuggerPageModel
    let isCompact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            filterSections
            stateSections
            analyticsSections
            logSections
        }
    }

    private var filterSections: some View {
        Group {
            TSFadeIn { FSMDebuggerFiltersPanel(model: model, isCompact: isCompact) }
            TSFadeIn(delay: 0.05) {
                FSMDebuggerHealthPanel(transitions: model.transitions, flapCount: model.flapIDs.count)
            }
        }
    }

    private var stateSections: some View {
        Group {
            TSFadeIn(delay: 0.1) { FSMDebuggerCurrentStatePanel(model: model, isCompact: isCompact) }
            TSFadeIn(delay: 0.15) { FSMDebuggerSubFSMPanel(subs: model.stats.activeSubs) }
            TSFadeIn(delay: 0.18) { FSMDebuggerLiveStatePanel(model: model) }
        }
    }

    private var analyticsSections: some View {
        Group {
            TSFadeIn(delay: 0.2) { FSMDebuggerStateDiagramPanel(nodes: model.diagramNodes) }
            TSFadeIn(delay: 0.25) { FSMDebuggerDistributionRow(model: model, isCompact: isCompact) }
            TSFadeIn(delay: 0.28) { FSMDebuggerSummaryCards(model: model, columns: isCompact ? 2 : 4) }
            TSFadeIn(delay: 0.3) {
                FSMDebuggerTimelinePanel(series: model.timelineSeries, isEmpty: model.transitions.isEmpty,
                                        emptyMessage: model.emptyRangeMessage)
            }
        }
    }

    private var logSections: some View {
        Group {
            TSFadeIn(delay: 0.25) { FSMDebuggerLogPanel(model: model, isCompact: isCompact) }
            if let selected = model.selectedTransition {
                TSFadeIn { FSMDebuggerDetailPanel(transition: selected) }
            }
        }
    }
}

// MARK: - Previews

#if DEBUG
    #Preview("FSM Debugger") {
        NavigationStack {
            StateMachineDebuggerPage()
        }
    }
#endif
