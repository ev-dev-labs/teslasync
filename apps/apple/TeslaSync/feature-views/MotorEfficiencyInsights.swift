//
//  MotorEfficiencyInsights.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  The Motor Efficiency Insights surface — the SwiftUI parity of
//  web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx.
//  Renders the web source's three panels (Torque Distribution, Throttle Behavior,
//  Motor Thermal) in a width-adaptive grid, plus the P4 leaf contract states. Binds
//  through `MotorEfficiencyInsightsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome (web parent `isLoading`).
//    • empty    — `motorStats` resolved null → each panel shows the web shared
//                 `EmptyState` ("No motor data recorded yet"), never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the three populated panels (web `FadeIn delay={0.35}`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                 banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - MotorEfficiencyInsights (the feature surface)

/// The Motor Efficiency Insights surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx`. Renders
/// every state from the web source plus the P4 leaf freshness states, binding through
/// `MotorEfficiencyInsightsModel`.
public struct MotorEfficiencyInsights: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MotorEfficiencyInsights"

    @State private var model: MotorEfficiencyInsightsModel

    public init(model: MotorEfficiencyInsightsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                connectivityBanner
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: MotorEfficiencyStrings.string(
            "dynamics.motorEfficiency", "Motor Efficiency"
        )))
    }
}

// MARK: - Header (surface title + the P4 freshness chip / refresh)

private extension MotorEfficiencyInsights {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: MotorEfficiencyStrings.string("dynamics.motorEfficiency", "Motor Efficiency"))
                .font(Font.TS.section)
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
            label = MotorEfficiencyStrings.string("motorEfficiency.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MotorEfficiencyStrings.string("motorEfficiency.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MotorEfficiencyStrings.string("motorEfficiency.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
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
        .accessibilityLabel(Text(verbatim: MotorEfficiencyStrings.string("motorEfficiency.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? MotorEfficiencyStrings.string("motorEfficiency.offlineBanner", "Offline — showing last known data")
            : MotorEfficiencyStrings.string("motorEfficiency.staleBanner", "Reconnecting — data may be stale")
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

// MARK: - Content states (web render branch + the P4 leaf contract)

private extension MotorEfficiencyInsights {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            MotorEfficiencyLoadingView()
        case .empty:
            // Web wraps the grid (including the per-panel EmptyState) in FadeIn.
            TSFadeIn(delay: 0.35) {
                MotorEfficiencyGrid(resolved: model.resolved, locale: model.formattingLocale)
            }
        case let .error(message):
            MotorEfficiencyErrorView(message: message) { model.refresh() }
        case .data:
            TSFadeIn(delay: 0.35) {
                MotorEfficiencyGrid(resolved: model.resolved, locale: model.formattingLocale)
            }
        }
    }
}
