//
//  SignalsWorkspacePage.swift
//  TeslaSync — P4 feature view · P7 · SignalsWorkspacePage (Apple)
//
//  SwiftUI / Apple HIG parity of the web `/signals` workspace
//  (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx). A thin
//  orchestrator over a single `@Observable` model: the live catalog, historical
//  query, live SSE monitor, and two-snapshot compare all share one screen with
//  two mutually-exclusive mode toggles. Adaptive across macOS (regular) and iOS
//  (compact / regular) per ADR-002 / ADR-006.
//
//  Eleven HIG panels:
//    1 Selected · 2 Mode · 3 Live-rate · 4 Pinned-signals   (HeadlineStrip)
//    5 GlassPanel5                                          (WorkspaceToolbar)
//    6 Changed-signals · 7 Visible-after-filter · 8 Pinned · 9 Window-span
//                                                           (CompareStatsStrip)
//    10 GlassPanel10                                        (CompareDiffPanel)
//    11 GlassPanel11                                        (catalog + content)
//

import SwiftUI

// MARK: - Main Page View

public struct SignalsWorkspacePage: View {
    @State private var model: SignalsWorkspacePageModel

    public init(model: SignalsWorkspacePageModel = SignalsWorkspacePageModel()) {
        _model = State(initialValue: model)
    }

    private var statColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 150), spacing: 12)]
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                if let banner = model.bannerError {
                    bannerView(banner)
                }

                if !model.hasVehicle {
                    WorkspacePanel {
                        WorkspaceStateEmpty(
                            title: WSText.noVehicle,
                            message: WSText.noVehicleDesc,
                            systemImage: "car.fill"
                        )
                    }
                }

                HeadlineStrip(model: model, columns: statColumns)

                SignalCatalogSection(model: model)

                WorkspaceToolbar(model: model) {
                    Task { await model.runHistory() }
                }

                if model.mode == .compare {
                    compareSection
                } else {
                    HistoricalLiveSection(model: model)
                }

                WorkspaceFooter()
            }
            .padding()
            .frame(maxWidth: 1200, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .navigationTitle(WSText.title)
        .background(backgroundStyle)
        .task { await model.load() }
        .onChange(of: model.selectedVehicleID) { _, _ in
            Task { await model.onVehicleChange() }
        }
        .onChange(of: model.atA) { _, _ in
            if model.mode == .compare { Task { await model.loadDiff() } }
        }
        .onChange(of: model.atB) { _, _ in
            if model.mode == .compare { Task { await model.loadDiff() } }
        }
        .onDisappear { model.stopLive() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(WSText.title).font(.largeTitle).fontWeight(.bold)
                    Text(WSText.subtitle).font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
            }
            actionsRow
        }
        .accessibilityElement(children: .contain)
    }

    private var actionsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 10) { actionControls }
            VStack(alignment: .leading, spacing: 10) { actionControls }
        }
    }

    @ViewBuilder private var actionControls: some View {
        vehiclePicker
        if model.mode == .live { liveConnectionBadge }
        Spacer(minLength: 0)
        ShareLink(item: permalink) {
            Label(WSText.share, systemImage: "square.and.arrow.up")
        }
        .accessibilityLabel(WSText.share)
    }

    private var vehiclePicker: some View {
        Picker("Vehicle", selection: $model.selectedVehicleID) {
            ForEach(model.vehicles) { vehicle in
                Text(vehicle.displayName).tag(vehicle.id)
            }
        }
        .pickerStyle(.menu)
        .accessibilityLabel("Vehicle")
    }

    private var liveConnectionBadge: some View {
        Label(
            model.liveConnected ? WSText.liveConnected : WSText.liveDisconnected,
            systemImage: "circle.fill"
        )
        .font(.caption)
        .foregroundStyle(model.liveConnected ? .green : .red)
    }

    private var permalink: String {
        "teslasync://signals?vehicle=\(model.selectedVehicleID)&mode=\(model.mode.rawValue)"
    }

    private func bannerView(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.callout)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityLabel("\(WSText.loadFailed): \(message)")
    }

    // MARK: - Compare section (panels 6–10 + controls)

    private var compareSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            compareControls
            CompareStatsStrip(model: model, columns: statColumns)
            CompareDiffPanel(model: model)
        }
    }

    private var compareControls: some View {
        WorkspacePanel {
            VStack(alignment: .leading, spacing: 12) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) { comparePickers }
                    VStack(alignment: .leading, spacing: 10) { comparePickers }
                }
                HStack(spacing: 10) {
                    TextField("Search", text: $model.diffSearch)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Filter changed signals")
                    categoryPicker
                }
            }
        }
    }

    @ViewBuilder private var comparePickers: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("A").font(.caption).foregroundStyle(.secondary)
            DatePicker("A", selection: $model.atA, displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
        }
        Image(systemName: "arrow.right").foregroundStyle(.secondary)
        VStack(alignment: .leading, spacing: 4) {
            Text("B").font(.caption).foregroundStyle(.secondary)
            DatePicker("B", selection: $model.atB, displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
        }
    }

    private var categoryPicker: some View {
        Picker("Category", selection: $model.diffCategory) {
            Text("All").tag(String?.none)
            ForEach(model.categories) { category in
                Text(category.title).tag(String?.some(category.key))
            }
        }
        .pickerStyle(.menu)
        .accessibilityLabel("Category filter")
    }

    private var backgroundStyle: some ShapeStyle {
        #if os(iOS)
        return Color(.systemGroupedBackground)
        #else
        return Color(nsColor: .windowBackgroundColor)
        #endif
    }
}

// MARK: - Preview

#if DEBUG
#Preview("SignalsWorkspace — Historical") {
    NavigationStack {
        SignalsWorkspacePage()
    }
}

#Preview("SignalsWorkspace — Compare") {
    let model = SignalsWorkspacePageModel()
    model.mode = .compare
    return NavigationStack {
        SignalsWorkspacePage(model: model)
    }
}
#endif
