//
//  EnergySummaryPanel.swift
//  TeslaSync — P4 feature view · 0142 · EnergySummaryPanel (Apple)
//
//  The drive energy-summary panel — the SwiftUI parity of
//  features/driving/components/drive-detail/EnergySummaryPanel.tsx. Renders the web
//  source's bolt header + six-up metric grid (Energy Consumed / Recovered, Net
//  Consumption, Efficiency, Battery Used, Range Used) inside a glass panel, plus the
//  P4 leaf contract states. Binds through `EnergySummaryModel` (P1/S8); no networking
//  lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid (web parent `isLoading`).
//    • empty    — parent resolved with no drive/stats snapshot → friendly empty state,
//                 never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full six-up metric grid (each cell with its web em-dash fallback).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - EnergySummaryPanel (the feature surface)

/// The drive energy-summary panel — the SwiftUI parity of
/// `features/driving/components/drive-detail/EnergySummaryPanel.tsx`. Renders every
/// state from the web source plus the P4 leaf freshness states, binding through
/// `EnergySummaryModel`.
public struct EnergySummaryPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EnergySummaryPanel"

    @State private var model: EnergySummaryModel

    public init(model: EnergySummaryModel) {
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
        .accessibilityLabel(Text(verbatim: EnergySummaryStrings.string(
            "driveDetail.energySummary", "Energy Summary"
        )))
    }
}

// MARK: - Header (web `<h3><BatteryCharging/> {title}</h3>` + freshness)

private extension EnergySummaryPanel {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "bolt.batteryblock.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesBattery)
                .accessibilityHidden(true)
            Text(verbatim: EnergySummaryStrings.string("driveDetail.energySummary", "Energy Summary"))
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
            label = EnergySummaryStrings.string("energySummary.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = EnergySummaryStrings.string("energySummary.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = EnergySummaryStrings.string("energySummary.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: EnergySummaryStrings.string("energySummary.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? EnergySummaryStrings.string("energySummary.offlineBanner", "Offline — showing last known data")
            : EnergySummaryStrings.string("energySummary.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (web grid + the P4 leaf contract)

private extension EnergySummaryPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            EnergySummaryLoadingView()
        case .empty:
            EnergySummaryEmptyView()
        case let .error(message):
            EnergySummaryErrorView(message: message) { model.refresh() }
        case .data:
            EnergySummaryContent(metrics: model.resolved.metrics)
        }
    }
}
