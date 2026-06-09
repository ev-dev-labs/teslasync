//
//  DrivingTips.swift
//  TeslaSync — P4 feature view · 0168 · DrivingTips (Apple)
//
//  The Driving Tips surface — the SwiftUI parity of
//  web/src/features/driving/components/driving-dynamics/DrivingTips.tsx. Renders the web
//  source's single glass panel (a `Lightbulb` header + a `space-y-3` list of driving
//  style recommendations) plus the P4 leaf contract states. Binds through
//  `DrivingTipsModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch → skeleton rows (web parent `isLoading`).
//    • empty   — `motorStats` null → the panel keeps rendering the single
//                "Drive your vehicle…" recommendation (web's own null branch).
//    • error   — parent query failure → retry affordance (web `QueryError` peer).
//    • data    — the computed recommendation list (web `FadeIn delay={0.6}`).
//    • stale / offline — the orthogonal `connection` axis → header freshness chip +
//                banner with a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - DrivingTips (the feature surface)

/// The Driving Tips surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/DrivingTips.tsx`. Renders every state
/// from the web source plus the P4 leaf freshness states, binding through
/// `DrivingTipsModel`.
public struct DrivingTips: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "DrivingTips"

    @State private var model: DrivingTipsModel

    public init(model: DrivingTipsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                if model.connection != .live {
                    connectivityBanner
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DrivingTipsStrings.string(
            "dynamics.recommendations", "Driving Style Recommendations"
        )))
    }
}

// MARK: - Header (web `Lightbulb` + `h2` title, plus the P4 freshness chip / refresh)

private extension DrivingTips {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "lightbulb.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .accessibilityHidden(true)
            Text(verbatim: DrivingTipsStrings.string(
                "dynamics.recommendations", "Driving Style Recommendations"
            ))
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
            label = DrivingTipsStrings.string("drivingTips.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = DrivingTipsStrings.string("drivingTips.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = DrivingTipsStrings.string("drivingTips.offline", "Offline")
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
        .accessibilityLabel(Text(verbatim: DrivingTipsStrings.string("drivingTips.refresh", "Refresh")))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let label = isOffline
            ? DrivingTipsStrings.string("drivingTips.offlineBanner", "Offline — showing last known data")
            : DrivingTipsStrings.string("drivingTips.staleBanner", "Reconnecting — data may be stale")
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

private extension DrivingTips {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            DrivingTipsLoadingList()
        case .empty:
            // Web keeps the panel and its single "Drive your vehicle…" recommendation;
            // the list still fades in (web `FadeIn delay={0.6}`).
            TSFadeIn(delay: 0.6) {
                DrivingTipsList(tips: model.resolved.tips, icon: model.resolved.icon)
            }
        case let .error(message):
            DrivingTipsErrorContent(message: message) { model.refresh() }
        case .data:
            TSFadeIn(delay: 0.6) {
                DrivingTipsList(tips: model.resolved.tips, icon: model.resolved.icon)
            }
        }
    }
}
