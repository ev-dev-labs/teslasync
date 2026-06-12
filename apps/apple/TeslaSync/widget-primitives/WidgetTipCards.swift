//
//  WidgetTipCards.swift
//  TeslaSync — P4 widget primitive · 0012 · WidgetTipCards (Apple)
//
//  The public API of the tip cards — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetTipCards.tsx`. Like the web component it is driven entirely by
//  its props (`tips`, `maxTips`, `compact`, `emptyMessage`, `emptyIcon`); there is no fetcher. The view
//  binds through ``WidgetTipCardsModel`` for the derived projection + the once-only `view.opened` telemetry
//  (P1/S11), composes the token-driven list (P1/S9), and pushes prop changes into the holder via
//  `.onChange` so a reused / rebound card re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The tip cards — the SwiftUI parity of `WidgetTipCards.tsx`. Renders a scrollable list of tip cards
/// (each an optional leading glyph, a title with an optional impact badge, and a description), capping at
/// `maxTips ?? (compact ? 1 : 3)` and clamping descriptions to two lines when `compact`, and falling back
/// to a friendly empty leaf when there is nothing to recommend. A shared widget building block — mount it
/// inside a dashboard widget that supplies the already-localized tips.
public struct WidgetTipCards: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetTipCardsSurface.slug

    private let input: WidgetTipCardsInput
    @State private var model: WidgetTipCardsModel

    /// The prop-style initializer — the parity of `<WidgetTipCards tips maxTips compact emptyMessage
    /// emptyIcon />`. `tips` are the already-localized recommendations; `maxTips` overrides the
    /// compact-aware default cap; `compact` (default `false`) keeps a single tip with a clamped
    /// description; `emptyMessage` / `emptyIconSymbol` override the empty-leaf copy + glyph.
    public init(
        tips: [TipItem],
        maxTips: Int? = nil,
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        telemetry: any WidgetTipCardsTelemetry = OSLogWidgetTipCardsTelemetry()
    ) {
        let resolved = WidgetTipCardsInput(
            tips: tips,
            maxTips: maxTips,
            compact: compact,
            emptyMessage: emptyMessage,
            emptyIconSymbol: emptyIconSymbol
        )
        input = resolved
        _model = State(initialValue: WidgetTipCardsModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetTipCardsModel) {
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

    /// The resolved list or the empty leaf — the native peer of the web render decision
    /// (`visible.length === 0 ? <EmptyState/> : <div className="space-y-2 overflow-y-auto h-full">…`).
    @ViewBuilder
    private var content: some View {
        switch model.projection {
        case .empty:
            WidgetTipCardsEmptyState(message: input.emptyMessage, iconSymbol: input.emptyIconSymbol)
        case let .populated(rows):
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(rows) { row in
                        TipCardView(row: row)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
        }
    }
}
