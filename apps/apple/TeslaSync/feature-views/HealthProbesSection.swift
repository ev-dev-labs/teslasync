//
//  HealthProbesSection.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  The composable system-status "Health Probes" surface — the SwiftUI parity of
//  features/system/components/status/HealthProbesSection.tsx. Renders inside a
//  collapsible accordion (web `<AccordionSection defaultOpen>`) fading in on appear
//  (web `<FadeIn>` pattern shared across the status page), and switches over the
//  bound model's phase so every prompt-required state renders (loading / content /
//  empty / error) — never a blank box — with the stale / offline freshness chrome
//  layered above. Binds through `HealthProbesModel` (P1/S8); no networking lives
//  here.
//

import SwiftUI

/// The composable system-status "Health Probes" section — the SwiftUI parity of the
/// web `HealthProbesSection`, binding through `HealthProbesModel` (P1/S8).
public struct HealthProbesSection: View {
    @State private var model: HealthProbesModel

    public init(model: HealthProbesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.045) {
            HealthProbesAccordion(
                systemImage: "waveform.path.ecg",
                titleKey: "Health Probes",
                titleFallback: "Health Probes",
                descriptionKey: "Liveness and readiness checks",
                descriptionFallback: "Liveness and readiness checks",
                defaultOpen: true,
                trailing: { trailing },
                content: { body(for: model.phase) }
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    // MARK: Header trailing (Live / Ready badges + freshness chip)

    /// The header accessory: the Live / Ready dot badges (web `badges` prop, shown
    /// only when the source has health data) and the stale / offline chip (the P4
    /// freshness contract, shown only when the source is not live).
    private var trailing: some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(model.headerBadges) { badge in
                HealthProbeHeaderBadge(badge: badge)
            }
            HealthProbesFreshnessChip(connection: model.connection)
        }
    }

    // MARK: Content (phase switch + freshness banner)

    /// The accordion body. The stale / offline banner sits above whatever the phase
    /// renders, so a cached snapshot stays visible and clearly labeled (web has no
    /// such banner — it is the prompt's offline/stale contract). The web `isLoading ?
    /// <Skeletons> : error ? <QueryError> : <two cards>` split is widened to the full
    /// loading / content / empty / error envelope.
    private func body(for phase: HealthProbesPhase) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                HealthProbesConnectivityBanner(connection: model.connection)
            }
            switch phase {
            case .loading:
                HealthProbesLoading()
            case .content:
                HealthProbesCardsGrid(cards: model.cards)
            case .empty:
                HealthProbesEmpty()
            case let .error(message):
                HealthProbesError(message: message) { model.retry() }
            }
        }
    }
}
