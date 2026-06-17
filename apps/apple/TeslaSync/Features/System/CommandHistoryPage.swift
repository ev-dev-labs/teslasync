//
//  CommandHistoryPage.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple)
//
//  Native SwiftUI parity of `web/src/features/system/pages/CommandHistoryPage.tsx`
//  (route `/command-history`): the audit log of every vehicle command. Reproduces the web
//  `PageContainer` chrome (title + subtitle + page-level loading / error), the header
//  actions (vehicle `Select`, the date-range picker, and the "back to Commands" link), the
//  four stat cards, the status/search filters panel, the command timeline, and the
//  pagination control. Adaptive across macOS (regular) and iPhone (compact) per ADR-002/006.
//
//  Data binds through the `@Observable` `CommandHistoryPageModel` (no networking in the
//  view, ADR-004); every visible string resolves from `Localizable.xcstrings` with the web
//  key names (ADR-014); all chrome uses the P2 design tokens (ADR-005). The command-history
//  source is a polled REST query (not a live SSE stream), so no staleness indicator applies.
//

import SwiftUI

// MARK: - Date-range presets (web `RangePicker` presets, default `all`)

/// The trailing window the timeline is filtered by (web `useRangeState` presets, default
/// `all`). `all` is unbounded so it matches the web default of showing the full history.
public enum CommandHistoryRangePreset: String, CaseIterable, Identifiable, Sendable {
    case all
    case last24h
    case last7d
    case last30d
    case last90d

    public var id: String { rawValue }

    var titleKey: LocalizedStringKey {
        switch self {
        case .all: "commandHistory.rangeAll"
        case .last24h: "commandHistory.range24h"
        case .last7d: "commandHistory.range7d"
        case .last30d: "commandHistory.range30d"
        case .last90d: "commandHistory.range90d"
        }
    }

    private var days: Double? {
        switch self {
        case .all: nil
        case .last24h: 1
        case .last7d: 7
        case .last30d: 30
        case .last90d: 90
        }
    }

    /// The `[start, end]` window for this preset relative to `now`.
    func interval(now: Date = Date()) -> (start: Date, end: Date) {
        guard let days else { return (Date(timeIntervalSince1970: 0), now) }
        return (now.addingTimeInterval(-days * 24 * 60 * 60), now)
    }
}

// MARK: - Page

public struct CommandHistoryPage: View {
    @State private var model: CommandHistoryPageModel
    @State private var rangePreset: CommandHistoryRangePreset = .all

    private let onOpenCommands: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// - Parameters:
    ///   - model: the `@Observable` state holder (defaults to the sample-backed source).
    ///   - onOpenCommands: navigation seam for the "back to Commands" link (web `/commands`),
    ///     wired by the host shell; defaults to a no-op for standalone / preview use.
    public init(
        model: CommandHistoryPageModel = CommandHistoryPageModel(),
        onOpenCommands: @escaping () -> Void = {}
    ) {
        _model = State(initialValue: model)
        self.onOpenCommands = onOpenCommands
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
        .navigationTitle(Text("commandHistory.title"))
        .task {
            switch model.state {
            case .loaded, .empty: return
            default: await model.load()
            }
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var statColumns: Int { isCompact ? 2 : 4 }

    // MARK: Header (web PageContainer title + subtitle + actions)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPageTitle("commandHistory.title")
                Text("commandHistory.subtitle")
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
            rangeMenu
            if !isCompact { Spacer(minLength: 0) }
            backToCommandsLink
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
        .accessibilityLabel(Text("commandHistory.selectVehicle"))
    }

    private var rangeMenu: some View {
        Menu {
            Picker(selection: rangePresetBinding) {
                ForEach(CommandHistoryRangePreset.allCases) { preset in
                    Text(preset.titleKey).tag(preset)
                }
            } label: {
                EmptyView()
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "calendar")
                Text(rangePreset.titleKey)
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textSecondary)
        }
    }

    private var backToCommandsLink: some View {
        Button(action: onOpenCommands) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "gamecontroller")
                Text("commandHistory.backToCommands")
            }
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
    }

    // MARK: State router (web PageContainer loading / error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            CommandHistoryLoadingView(columns: statColumns)
        case let .error(message):
            CommandHistoryErrorView(message: message) {
                Task { await model.refresh() }
            }
        case .empty, .loaded:
            populatedBody
        }
    }

    private var populatedBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            CommandHistoryStatsGrid(stats: model.stats, columns: statColumns)
            CommandHistoryFiltersPanel(model: model, isCompact: isCompact)
            CommandHistoryTimelinePanel(model: model)
            if model.showsPagination {
                CommandHistoryPaginationBar(model: model)
            }
        }
    }

    // MARK: Bindings

    private var vehicleBinding: Binding<String?> {
        Binding(
            get: { model.selectedVehicleStringID },
            set: { newValue in
                let id = newValue.flatMap(Int64.init)
                Task { await model.vehicleChanged(to: id) }
            }
        )
    }

    private var rangePresetBinding: Binding<CommandHistoryRangePreset> {
        Binding(
            get: { rangePreset },
            set: { preset in
                rangePreset = preset
                let window = preset.interval()
                model.rangeChanged(start: window.start, end: window.end)
            }
        )
    }
}

// MARK: - Previews

#if DEBUG
    #Preview("Command History") {
        NavigationStack {
            CommandHistoryPage()
        }
    }
#endif
