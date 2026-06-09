//
//  FSMHealthPanel.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  The composable FSM-health surface — the SwiftUI parity of
//  features/system/components/FSMHealthPanel.tsx. Renders inside a glass panel (web
//  `GlassPanel`) fading in on appear, and switches over the bound model's phase so every
//  prompt-required state renders (loading / healthy / alerts / error / stale / offline) —
//  never a blank box. Binds through `FSMHealthPanelModel` (P1/S8); no networking lives here.
//
//  Parity envelope: with a live connection the surface matches the web exactly — the
//  all-clear row when there are no alerts (no title, web `alerts.length === 0`), or the
//  uppercase "FSM Health" title above the alert grid when there are. The freshness chip +
//  connectivity banner are the P4 leaf contract layered on top, shown only when the bound
//  source is stale / offline (the web component itself does not model connectivity — its
//  parent does).
//

import SwiftUI

/// The composable FSM-health panel — the SwiftUI parity of the web `FSMHealthPanel`,
/// binding through `FSMHealthPanelModel` (P1/S8).
public struct FSMHealthPanel: View {
    @State private var model: FSMHealthPanelModel

    public init(model: FSMHealthPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    if showsHeader {
                        header
                    }
                    if model.connection != .live {
                        FSMHealthConnectivityBanner(connection: model.connection)
                    }
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `<h2>` title appears only above the alert grid (`alerts.length > 0`).
    private var showsTitle: Bool {
        if case .alerts = model.phase { return true }
        return false
    }

    /// The freshness chip is the P4 envelope — shown only when the source is not live.
    private var showsChip: Bool {
        model.connection != .live
    }

    private var showsHeader: Bool {
        showsTitle || showsChip
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            if showsTitle {
                FSMHealthTitle()
            }
            Spacer(minLength: TSSpacing.sm)
            if showsChip {
                FSMHealthFreshnessChip(connection: model.connection)
            }
        }
    }

    /// The web all-clear / alert-grid split, widened to the full load envelope (loading /
    /// error / healthy / alerts) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FSMHealthLoadingView()
        case let .error(message):
            FSMHealthError(message: message) { model.refresh() }
        case .healthy:
            FSMHealthAllClearRow()
        case let .alerts(alerts):
            FSMHealthAlertGrid(alerts: alerts, locale: model.displayLocale)
        }
    }
}
