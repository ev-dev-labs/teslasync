//
//  WidgetComparisonCard.swift
//  TeslaSync — P4 widget primitive · 0003 · WidgetComparisonCard (Apple)
//
//  The public API of the comparison card — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetComparisonCard.tsx`. Like the web component it is driven
//  entirely by its props (`metrics`, the optional `compact`); there is no fetcher. The view binds through
//  ``WidgetComparisonCardModel`` for the derived projection + the once-only `view.opened` telemetry
//  (P1/S11), composes the token-driven column (P1/S9), and pushes prop changes into the holder via
//  `.onChange` so a reused / rebound card re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The comparison card — the SwiftUI parity of `WidgetComparisonCard.tsx`. Renders a column of comparison
/// rows (each a label, the formatted current value with an optional unit, and a direction-aware ``Delta``
/// against the previous period), condensing to the first two metrics when `compact`, and falling back to a
/// friendly empty leaf when there is nothing to compare. A shared widget building block — mount it inside a
/// dashboard widget that supplies the already-formatted, already-converted metrics.
public struct WidgetComparisonCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetComparisonCardSurface.slug

    private let input: WidgetComparisonCardInput
    @State private var model: WidgetComparisonCardModel

    /// The prop-style initializer — the parity of `<WidgetComparisonCard metrics compact />`. `metrics` are
    /// the already-formatted, already-converted comparison rows; `compact` (default `false`) keeps only the
    /// first two, exactly like the web `metrics.slice(0, 2)`.
    public init(
        metrics: [ComparisonMetric],
        compact: Bool = false,
        telemetry: any WidgetComparisonCardTelemetry = OSLogWidgetComparisonCardTelemetry()
    ) {
        let resolved = WidgetComparisonCardInput(metrics: metrics, compact: compact)
        input = resolved
        _model = State(initialValue: WidgetComparisonCardModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetComparisonCardModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput)
            }
    }

    /// The resolved column or the empty leaf — the native peer of the web render decision
    /// (`visible.length === 0 ? <p/> : <div className="flex flex-col">…`).
    @ViewBuilder
    private var content: some View {
        switch model.projection {
        case .empty:
            WidgetComparisonCardEmptyState()
        case let .populated(rows):
            VStack(spacing: 0) {
                ForEach(rows) { row in
                    ComparisonMetricRow(row: row)
                }
            }
            .accessibilityElement(children: .contain)
        }
    }
}
