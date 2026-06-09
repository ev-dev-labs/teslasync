//
//  InfrastructureSection.swift
//  TeslaSync — P4 feature view · 0248 · InfrastructureSection (Apple)
//
//  The composable system-status "Infrastructure" surface — the SwiftUI parity of
//  features/system/components/status/InfrastructureSection.tsx. Renders inside a
//  collapsible accordion (web `<AccordionSection>`, collapsed by default — the web
//  passes no `defaultOpen`) fading in on appear (web `<FadeIn>` pattern shared across
//  the status page), and switches over the bound model's phase so every prompt-
//  required state renders (loading / content / empty / error) — never a blank box —
//  with the stale / offline freshness chrome layered above. Binds through
//  `InfrastructureModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The composable system-status "Infrastructure" section — the SwiftUI parity of the
/// web `InfrastructureSection`, binding through `InfrastructureModel` (P1/S8).
public struct InfrastructureSection: View {
    @State private var model: InfrastructureModel
    private let initiallyExpanded: Bool

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Designated initializer. `initiallyExpanded` mirrors the web `defaultOpen`
    /// (false — the web source passes none); previews/tests open it to show content.
    public init(model: InfrastructureModel, initiallyExpanded: Bool = false) {
        _model = State(initialValue: model)
        self.initiallyExpanded = initiallyExpanded
    }

    /// Convenience initializer over a bare `InfrastructureSource`.
    public init(
        source: any InfrastructureSource,
        telemetry: any InfrastructureTelemetry = OSLogInfrastructureTelemetry(),
        initiallyExpanded: Bool = false
    ) {
        _model = State(initialValue: InfrastructureModel(source: source, telemetry: telemetry))
        self.initiallyExpanded = initiallyExpanded
    }

    public var body: some View {
        TSFadeIn(delay: 0.045) {
            InfrastructureAccordion(
                systemImage: "globe",
                titleKey: "Infrastructure",
                titleFallback: "Infrastructure",
                descriptionKey: "SSE connections and polling engine diagnostics",
                descriptionFallback: "SSE connections and polling engine diagnostics",
                defaultOpen: initiallyExpanded,
                trailing: { trailing },
                content: { body(for: model.phase) }
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    // MARK: Header trailing (connection badge + freshness chip)

    /// The header accessory: the SSE Connected/Disconnected dot badge (web `badges`
    /// prop — success when connected, warning otherwise) and the stale / offline chip
    /// (the P4 freshness contract, shown only when the source is not live).
    private var trailing: some View {
        HStack(spacing: TSSpacing.sm) {
            InfraStateBadge(
                titleKey: model.sseConnected ? "Connected" : "Disconnected",
                fallback: model.sseConnected ? "Connected" : "Disconnected",
                tone: model.sseConnected ? .success : .warning,
                dot: true
            )
            InfraFreshnessChip(connection: model.connection)
        }
    }

    // MARK: Content (phase switch + freshness banner)

    /// The accordion body. The stale / offline banner sits above whatever the phase
    /// renders, so a cached snapshot stays visible and clearly labeled (web has no such
    /// banner — it is the prompt's offline/stale contract).
    private func body(for phase: InfraPhase) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.connection != .live {
                InfraConnectivityBanner(connection: model.connection)
            }
            switch phase {
            case .loading:
                InfrastructureLoading()
            case .content:
                content
            case .empty:
                InfrastructureEmpty()
            case let .error(message):
                InfrastructureError(message: message) { model.retry() }
            }
        }
    }

    /// The populated body (web): the responsive two-card grid (SSE Connection + Polling
    /// Engine), then the database-pool metric row when the source has a pool snapshot
    /// (web `{extHealth?.database_pool && …}`).
    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            cardGrid
            if let stats = model.poolStats {
                InfraConnectionPoolRow(stats: stats)
            }
        }
    }

    /// The web `Grid cols={{ default: 1, md: 2 }}` — one column on compact iPhone
    /// widths, two columns on regular widths and macOS.
    private var cardGrid: some View {
        LazyVGrid(
            columns: Array(
                repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
                count: columnCount
            ),
            alignment: .leading,
            spacing: TSSpacing.lg
        ) {
            InfraSSEConnectionCard(info: model.sse)
            InfraPollingEngineCard(info: model.polling)
        }
    }

    private var columnCount: Int {
        #if os(iOS)
            horizontalSizeClass == .compact ? 1 : 2
        #else
            2
        #endif
    }
}
