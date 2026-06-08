//
//  CostSavingsPanel.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  The drive-detail cost & savings panel — the SwiftUI parity of
//  features/driving/components/drive-detail/CostSavingsPanel.tsx. Renders the web
//  source's regions (the dollar-sign header and the responsive stat grid: Trip
//  Cost, Cost/unit, and the gas-equivalent / savings / savings-% trio) inside a
//  glass panel, plus the P4 leaf contract states. Binds through `CostSavingsModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid (web parent loading).
//    • empty    — resolved drive with no energy and no distance → friendly empty
//                 state, never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (the visible subset of the five web cells).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - CostSavingsPanel (the feature surface)

/// The drive-detail cost & savings panel — the SwiftUI parity of
/// `features/driving/components/drive-detail/CostSavingsPanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `CostSavingsModel`.
public struct CostSavingsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "CostSavingsPanel"

    @State private var model: CostSavingsModel

    public init(model: CostSavingsModel) {
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
        .accessibilityLabel(Text(verbatim: CostSavingsStrings.string(
            "driveDetail.costSavings", "Cost & Savings"
        )))
    }
}

// MARK: - Header (web `<h3><DollarSign/> {title}</h3>` + freshness)

private extension CostSavingsPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "dollarsign.circle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            Text(verbatim: CostSavingsStrings.string("driveDetail.costSavings", "Cost & Savings"))
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
            label = CostSavingsStrings.string("costSavings.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = CostSavingsStrings.string("costSavings.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = CostSavingsStrings.string("costSavings.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: CostSavingsStrings.string("costSavings.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? CostSavingsStrings.string("costSavings.offlineBanner", "Offline — showing last known data")
            : CostSavingsStrings.string("costSavings.staleBanner", "Reconnecting — data may be stale")
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

private extension CostSavingsPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            CostSavingsLoadingView()
        case .empty:
            CostSavingsEmptyView()
        case let .error(message):
            CostSavingsErrorView(message: message) { model.refresh() }
        case .data:
            CostSavingsContent(tiles: model.resolved.tiles)
        }
    }
}
