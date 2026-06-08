//
//  BackendStatusSection.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  The composable system-status "Backend Status" surface — the SwiftUI parity of
//  features/system/components/status/BackendStatusSection.tsx. Renders inside a
//  collapsible accordion (web `<AccordionSection defaultOpen>`) fading in on appear
//  (web `<FadeIn>` pattern shared across the status page), and switches over the
//  bound model's phase so every prompt-required state renders (loading / content /
//  empty / error) — never a blank box — with the stale / offline freshness chrome
//  layered above. Binds through `BackendStatusModel` (P1/S8); no networking lives
//  here.
//

import SwiftUI

/// The composable system-status "Backend Status" section — the SwiftUI parity of
/// the web `BackendStatusSection`, binding through `BackendStatusModel` (P1/S8).
public struct BackendStatusSection: View {
    @State private var model: BackendStatusModel

    public init(model: BackendStatusModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.045) {
            BackendStatusAccordion(
                systemImage: "server.rack",
                titleKey: "Backend Status",
                titleFallback: "Backend Status",
                descriptionKey: "Component health, database pool, and runtime info",
                descriptionFallback: "Component health, database pool, and runtime info",
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

    // MARK: Header trailing (health badge + freshness chip)

    /// The header accessory: the "okCount/total healthy" badge (web `badges` prop,
    /// shown only when there are component rows) and the stale / offline chip (the
    /// P4 freshness contract, shown only when the source is not live).
    private var trailing: some View {
        HStack(spacing: TSSpacing.sm) {
            if model.componentCount > 0 {
                BackendHealthBadge(okCount: model.okCount, total: model.componentCount)
            }
            BackendStatusFreshnessChip(connection: model.connection)
        }
    }

    // MARK: Content (phase switch + freshness banner)

    /// The accordion body. The stale / offline banner sits above whatever the phase
    /// renders, so a cached snapshot stays visible and clearly labeled (web has no
    /// such banner — it is the prompt's offline/stale contract). The web
    /// `isLoading ? <Skeletons> : <three sections>` split is widened to the full
    /// loading / content / empty / error envelope.
    private func body(for phase: BackendPhase) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.connection != .live {
                BackendStatusConnectivityBanner(connection: model.connection)
            }
            switch phase {
            case .loading:
                BackendStatusLoading()
            case .content:
                content
            case .empty:
                BackendStatusEmpty()
            case let .error(message):
                BackendStatusError(message: message) { model.retry() }
            }
        }
    }

    /// The three populated sections (web body): Component Health always renders
    /// (owning its own inline empty message); the Connection Pool and System
    /// Runtime sections render only when the source has their data (web `{pool && …}`
    /// / `{(extHealth?.system || version) && …}`).
    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            BackendComponentHealthSection(rows: model.componentRows)
            if let stats = model.poolStats {
                BackendConnectionPoolSection(stats: stats)
            }
            if let runtime = model.runtimeRows {
                BackendSystemRuntimeSection(rows: runtime)
            }
        }
    }
}
