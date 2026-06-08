//
//  AcDcStatsPanel.swift
//  TeslaSync — P4 feature view · 0096 · AcDcStatsPanel (Apple)
//
//  The AC-vs-DC charging stats panel — the SwiftUI parity of
//  features/charging/components/charging-list/AcDcStatsPanel.tsx. Renders the web
//  source's regions (the bolt header, the AC/DC energy-split bar, the per-type stats
//  table, and the free-charging footer) inside a glass panel, plus the P4 leaf
//  contract states. Binds through `AcDcStatsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — breakdown resolved, no charge type has sessions → friendly empty
//                 state (the web `DataTable` empty render), never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full panel (split bar + table + optional free footer).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AcDcStatsPanel (the feature surface)

/// The AC-vs-DC charging stats panel — the SwiftUI parity of
/// `features/charging/components/charging-list/AcDcStatsPanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `AcDcStatsModel`.
public struct AcDcStatsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AcDcStatsPanel"

    @State private var model: AcDcStatsModel

    public init(model: AcDcStatsModel) {
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
        .accessibilityLabel(Text(verbatim: AcDcStrings.string(
            "charging.stats.chargingByType", "Charging Stats by Type"
        )))
    }
}

// MARK: - Header (web `<h3 class="section-title"><Zap/> {title}</h3>` + freshness)

private extension AcDcStatsPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: AcDcStrings.string("charging.stats.chargingByType", "Charging Stats by Type"))
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
            label = AcDcStrings.string("acdc.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = AcDcStrings.string("acdc.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = AcDcStrings.string("acdc.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: AcDcStrings.string("acdc.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? AcDcStrings.string("acdc.offlineBanner", "Offline — showing last known data")
            : AcDcStrings.string("acdc.staleBanner", "Reconnecting — data may be stale")
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

private extension AcDcStatsPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AcDcLoadingView()
        case .empty:
            AcDcEmptyView()
        case let .error(message):
            AcDcErrorView(message: message) { model.refresh() }
        case .data:
            AcDcContent(resolved: model.resolved)
        }
    }
}
