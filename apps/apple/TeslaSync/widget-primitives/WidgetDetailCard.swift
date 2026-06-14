//
//  WidgetDetailCard.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  The public API of the detail card — the SwiftUI parity of
//  `features/dashboard/widgets/shared/WidgetDetailCard.tsx`. Like the web component it is driven entirely
//  by its props (`entries`, `compact`, `emptyMessage`, `emptyIcon`); there is no fetcher. The view binds
//  through ``WidgetDetailCardModel`` for the derived projection + the once-only `view.opened` telemetry
//  (P1/S11), composes the token-driven, scrollable column (P1/S9), and pushes prop changes into the holder
//  via `.onChange` so a reused / rebound card re-renders faithfully. No networking, no Tailwind ports.
//

import SwiftUI

/// The detail card — the SwiftUI parity of `WidgetDetailCard.tsx`. Renders a scrollable column of
/// label/value rows (each an uppercase muted label, the formatted value with an optional monospaced font,
/// and an optional trailing badge), condensing to the first four entries when `compact`, and falling back
/// to a friendly empty leaf when there is nothing to show. A shared widget building block — mount it inside
/// a dashboard widget that supplies the already-formatted, already-localized entries.
public struct WidgetDetailCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WidgetDetailCardSurface.slug

    private let input: WidgetDetailCardInput
    @State private var model: WidgetDetailCardModel

    /// The prop-style initializer — the parity of `<WidgetDetailCard entries compact emptyMessage
    /// emptyIcon />`. `entries` are the already-formatted, already-localized rows; `compact` (default
    /// `false`) keeps only the first four, exactly like the web `entries.slice(0, 4)`; `emptyMessage` /
    /// `emptyIconSymbol` override the empty-leaf copy + glyph.
    public init(
        entries: [DetailEntry],
        compact: Bool = false,
        emptyMessage: String? = nil,
        emptyIconSymbol: String? = nil,
        telemetry: any WidgetDetailCardTelemetry = OSLogWidgetDetailCardTelemetry()
    ) {
        let resolved = WidgetDetailCardInput(
            entries: entries,
            compact: compact,
            emptyMessage: emptyMessage,
            emptyIconSymbol: emptyIconSymbol
        )
        input = resolved
        _model = State(initialValue: WidgetDetailCardModel(input: resolved, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: WidgetDetailCardModel) {
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

    /// The resolved scrollable column or the empty leaf — the native peer of the web render decision
    /// (`entries.length === 0 ? <EmptyState/> : <div className="overflow-y-auto h-full">…`). The
    /// ``SwiftUI/ScrollView`` with `.basedOnSize` bounce is the native peer of the web `overflow-y-auto`
    /// (it only scrolls when the rows exceed the host's allotted height — the web `h-full`).
    @ViewBuilder
    private var content: some View {
        switch model.projection {
        case .empty:
            WidgetDetailCardEmptyState(message: input.emptyMessage, iconSymbol: input.emptyIconSymbol)
        case let .populated(rows):
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(rows) { row in
                        DetailEntryRow(row: row)
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
        }
    }
}
