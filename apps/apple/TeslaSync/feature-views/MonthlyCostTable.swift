//
//  MonthlyCostTable.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  The monthly cost-breakdown table — the SwiftUI parity of
//  features/charging/components/cost-analysis/MonthlyCostTable.tsx. Renders the web
//  source's regions (the chart-bar header + the sortable per-month `DataTable`) inside a
//  glass panel, plus the P4 leaf contract states. Binds through `MonthlyCostTableModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — buckets resolved but empty → friendly empty state (the web
//                 `sortedData.length > 0 ? table : noData` else-branch), never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full sortable table (default month / desc).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner
//                 with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - MonthlyCostTable (the feature surface)

/// The monthly cost-breakdown table — the SwiftUI parity of
/// `features/charging/components/cost-analysis/MonthlyCostTable.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `MonthlyCostTableModel`.
public struct MonthlyCostTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MonthlyCostTable"

    @State private var model: MonthlyCostTableModel

    public init(model: MonthlyCostTableModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: MonthlyCostTableStrings.string(
            "costAnalysis.table.title", "Monthly Cost Breakdown"
        )))
    }
}

// MARK: - Header (web `<h3><BarChart3/> {title}</h3>` + freshness)

private extension MonthlyCostTable {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "chart.bar.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: MonthlyCostTableStrings.string("costAnalysis.table.title", "Monthly Cost Breakdown"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = MonthlyCostTableStrings.string("monthlyCost.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MonthlyCostTableStrings.string("monthlyCost.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MonthlyCostTableStrings.string("monthlyCost.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text(verbatim: MonthlyCostTableStrings.string("monthlyCost.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? MonthlyCostTableStrings.string("monthlyCost.offlineBanner", "Offline — showing last known data")
            : MonthlyCostTableStrings.string("monthlyCost.staleBanner", "Reconnecting — data may be stale")
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web shell + the P4 leaf contract)

private extension MonthlyCostTable {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            MonthlyCostLoadingView()
        case .empty:
            MonthlyCostEmptyView()
        case let .error(message):
            MonthlyCostErrorView(message: message) { model.refresh() }
        case .data:
            MonthlyCostContent(rows: model.resolved.rows)
        }
    }
}
