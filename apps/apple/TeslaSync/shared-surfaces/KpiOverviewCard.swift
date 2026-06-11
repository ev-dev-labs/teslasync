//
//  KpiOverviewCard.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The KPI overview card surface — the SwiftUI parity of
//  `web/src/components/data-display/KpiOverviewCard.tsx`. The web component is a presentational shell:
//  a `GlassPanel` composing a `ComparisonHeader` (title + current/comparison period strip + optional
//  headline delta + optional actions), a responsive KPI grid of `MetricCard` tiles, an optional muted
//  `secondary` fold-down line, and an optional `footer` `InlineCallout`. It is the consistent visual
//  shell every overview surface (Drives, Charging, Trips, …) renders so they all read as one product.
//
//  The native parity keeps that shell and binds it through `KpiOverviewCardModel` (P1/S8) — no
//  networking lives here — rendering every state so the surface never collapses to a blank box:
//    • loading  — the page computing its numbers → a skeleton KPI grid under the header.
//    • empty    — data resolved with no tiles → a friendly empty state (web `EmptyState`).
//    • error    — feed failure → a retry affordance (web `QueryError` peer).
//    • content  — the web happy path: header + KPI grid + optional secondary + optional footer.
//    • stale / offline — the orthogonal connectivity axis → a freshness chip in the header with a
//                 one-shot auto-refresh on the stale transition; the last content stays visible.
//  The header always renders (the title + period are static page copy), so the panel keeps its frame.
//

import SwiftUI

/// The KPI overview card surface — the SwiftUI parity of the web `KpiOverviewCard`. Renders every
/// state plus the P4 leaf freshness states, binding through `KpiOverviewCardModel`.
public struct KpiOverviewCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = KpiOverviewMeta.surfaceSlug

    @State private var model: KpiOverviewCardModel
    private let onFooterAction: (() -> Void)?

    /// Designated initializer — adopts a fully-formed model (a spy source / telemetry in tests, the
    /// production source in the app) and an optional footer-action handler.
    public init(model: KpiOverviewCardModel, onFooterAction: (() -> Void)? = nil) {
        _model = State(initialValue: model)
        self.onFooterAction = onFooterAction
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<KpiOverviewCard header={…} kpis={…} secondary={…} footer={…} />`. Seeds a live source with the
    /// host snapshot; the host pushes further snapshots as the page recomputes.
    public init(
        input: KpiOverviewInput,
        telemetry: any KpiOverviewTelemetry = OSLogKpiOverviewTelemetry(),
        onFooterAction: (() -> Void)? = nil
    ) {
        let source = LiveKpiOverviewSource(snapshot: input)
        _model = State(initialValue: KpiOverviewCardModel(source: source, telemetry: telemetry))
        self.onFooterAction = onFooterAction
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                KpiOverviewHeaderView(
                    header: model.resolved.header,
                    connection: model.connection
                ) {
                    model.refresh()
                }

                body(for: model.resolved)

                if let secondary = model.resolved.secondary {
                    KpiOverviewSecondaryView(text: secondary)
                }

                if let footer = model.resolved.footer {
                    KpiOverviewFooterView(callout: footer, onAction: onFooterAction)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func body(for resolved: KpiOverviewResolved) -> some View {
        switch resolved.phase {
        case .loading:
            KpiOverviewLoadingView()
        case .empty:
            KpiOverviewEmptyView()
        case let .error(message):
            KpiOverviewErrorView(message: message) { model.refresh() }
        case .content:
            KpiOverviewGridView(items: resolved.items)
        }
    }
}
