//
//  SignalExplorerPage.swift
//  TeslaSync — P4 feature view · P7 · SignalExplorerPage (Apple)
//
//  SwiftUI / Apple HIG parity of the web `/signal-explorer` page
//  (web/src/features/telemetry/pages/SignalExplorerPage.tsx). A thin orchestrator
//  over a single `@Observable` model: the useSignals catalog (with its loading /
//  empty / error / success states), the GlassPanel control surface, the Helix
//  NL-filter shared surface, and the historical / live results region. Adaptive
//  across macOS (regular) and iOS (compact / regular) per ADR-002 / ADR-006.
//
//  Regions (faithful to the web source, top to bottom):
//    • header — title + subtitle + the vehicle picker and the live badge
//    • error banner (web `AlertBanner` over `anyError`)
//    • no-vehicle empty state (web `vehicleId === 0` branch)
//    • GlassPanel1 — the signal selector + range + per-page + Explore / Live
//    • the Helix NL-filter surface (web `<AISignalExplorerNlFilter/>`)
//    • the resting "pick signals" empty state, OR the stats / series / history
//

import SwiftUI

public struct SignalExplorerPage: View {
    @State private var model: SignalExplorerPageModel

    public init(model: SignalExplorerPageModel = SignalExplorerPageModel()) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header

                if let banner = model.bannerError {
                    ExplorerErrorBanner(message: banner)
                }

                if !model.hasVehicle {
                    noVehicleState
                } else {
                    SignalExplorerControlPanel(model: model)
                    aiSection
                    resultsRegion
                }
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: 1100, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text(verbatim: SEText.title))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.large)
        #endif
        .refreshable { await model.refresh() }
        .task { await model.load() }
        .onChange(of: model.selectedVehicleID) { _, _ in
            Task { await model.onVehicleChange() }
        }
        .onDisappear { model.stopLive() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: SEText.title)
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: SEText.subtitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            actionsRow
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var actionsRow: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) { actionControls }
            VStack(alignment: .leading, spacing: TSSpacing.sm) { actionControls }
        }
    }

    @ViewBuilder private var actionControls: some View {
        vehiclePicker
        if model.isLive { liveBadge }
        Spacer(minLength: 0)
    }

    private var vehiclePicker: some View {
        Picker(selection: $model.selectedVehicleID) {
            ForEach(model.vehicles) { vehicle in
                Text(verbatim: vehicle.displayName).tag(vehicle.id)
            }
        } label: {
            Text("vehicle.picker")
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .accessibilityLabel(Text("vehicle.picker"))
    }

    /// Web live badge (`liveMonitor.connected` / `liveMonitor.disconnected`), with
    /// a staleness tint once the stream passes the two-minute freshness window.
    private var liveBadge: some View {
        Label {
            Text(verbatim: model.liveConnected ? SEText.liveConnected : SEText.liveDisconnected)
        } icon: {
            Image(systemName: "circle.fill").font(.system(size: 8))
        }
        .font(Font.TS.caption)
        .foregroundStyle(badgeColor)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(badgeColor.opacity(0.12), in: Capsule())
        .accessibilityLabel(
            Text(verbatim: model.liveConnected ? SEText.liveConnected : SEText.liveDisconnected)
        )
    }

    private var badgeColor: Color {
        if model.liveConnected {
            return model.isLiveStale ? Color.TS.statusWarning : Color.TS.statusSuccess
        }
        return Color.TS.statusDanger
    }

    // MARK: - No-vehicle empty state (web `vehicleId === 0`)

    private var noVehicleState: some View {
        ExplorerStateEmpty(
            title: SEText.noVehicle,
            message: SEText.noVehicleDesc,
            systemImage: "car.fill"
        )
        .frame(maxWidth: .infinity, minHeight: 280)
    }

    // MARK: - AI NL-filter surface (web `<AISignalExplorerNlFilter/>`)

    @ViewBuilder private var aiSection: some View {
        if let aiModel = model.aiFilterModel {
            AISignalExplorerNlFilter(model: aiModel)
        }
    }

    // MARK: - Results / resting empty (web `!hasHistorical && !isLive`)

    @ViewBuilder private var resultsRegion: some View {
        if model.showsRestingEmpty {
            ExplorerStateEmpty(
                title: SEText.pickSignalsTitle,
                message: SEText.exploreHint,
                systemImage: "rectangle.and.text.magnifyingglass"
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            SignalExplorerResults(model: model)
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview("SignalExplorer") {
    NavigationStack {
        SignalExplorerPage()
    }
}
#endif
