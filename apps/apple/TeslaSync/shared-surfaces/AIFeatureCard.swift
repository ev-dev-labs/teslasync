//
//  AIFeatureCard.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The reusable AI-feature scaffold — the SwiftUI parity of `components/ai/AIFeatureCard.tsx`.
//  Reproduces the web source's composition (the `GlassPanel` wrapper, the header with the cyan Helix
//  badge + description + optional empty hint, the optional prompt-input slot, the universal
//  "Ask Helix" action with its streaming-aware label, the optional domain `children`, and the
//  streamed `AiOutputPanel`) plus the P4 leaf connectivity axis. Parameterised by the per-feature
//  `AIFeatureCardContent` and bound through `AIFeatureCardModel` (P1/S8); no networking lives here.
//
//  Faithful to the web contract, the scaffold is NOT gated by `withAiFeature` (the gate stays at
//  each call site) and does NOT own the stream (the host injects the lifecycle through the source
//  seam). Every state renders — no hidden surface:
//    • idle/ready   — nothing streamed yet → the resting invite card (header + "Ask Helix").
//    • disabled     — `canStart` false → the action is disabled and the empty hint shows.
//    • streaming    — SSE open, no text → "Helix is thinking…" + the thinking indicator.
//    • text/done    — deltas arrived → the accumulated narrative in the output panel.
//    • error        — the stream ended in `error` → the Helix error row.
//    • stale/offline— the orthogonal `connection` axis → freshness chip + banner with a one-shot
//                     auto-refresh on the stale transition; offline disables the action.
//

import SwiftUI

// MARK: - AIFeatureCard (the reusable shared surface)

/// The reusable AI-feature scaffold — the SwiftUI parity of `components/ai/AIFeatureCard.tsx`,
/// generic over the optional prompt-input slot and the optional domain `children`. Renders every
/// state from the web source plus the P4 leaf states, binding through `AIFeatureCardModel`.
public struct AIFeatureCard<InputSlot: View, Extra: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AIFeatureCardMeta.surfaceSlug
    }

    @State private var model: AIFeatureCardModel
    private let content: AIFeatureCardContent
    private let placement: AIFeatureCardButtonPlacement
    private let inputSlot: InputSlot
    private let extra: Extra
    private let hasInputSlot: Bool

    /// Designated initializer — binds a pre-built model and the per-feature content, with the prompt
    /// input slot (rendered between header and action) and the domain children (rendered between the
    /// action and the output panel) supplied as view builders.
    public init(
        model: AIFeatureCardModel,
        content: AIFeatureCardContent,
        placement: AIFeatureCardButtonPlacement = .inline,
        @ViewBuilder inputSlot: () -> InputSlot,
        @ViewBuilder children: () -> Extra
    ) {
        _model = State(initialValue: model)
        self.content = content
        self.placement = placement
        self.inputSlot = inputSlot()
        extra = children()
        hasInputSlot = InputSlot.self != EmptyView.self
    }

    private var effectivePlacement: AIFeatureCardButtonPlacement {
        AIFeatureCardLogic.effectivePlacement(placement, hasInputSlot: hasInputSlot)
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                AIFeatureCardConnectivityChip(connection: model.connection) { model.refresh() }
                if model.connection != .live {
                    AIFeatureCardConnectivityBanner(connection: model.connection)
                }
                headerRow
                if hasInputSlot {
                    inputSlot
                }
                if effectivePlacement == .below {
                    HStack { Spacer(minLength: 0); actionButton }
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
                extra
                AIFeatureCardOutputPanel(output: model.output)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The header row: inline places the action trailing on the header line (web compact layout);
    /// below renders the header alone (the action sits on its own row beneath the input slot).
    @ViewBuilder
    private var headerRow: some View {
        if effectivePlacement == .inline {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                header
                actionButton
            }
        } else {
            header
        }
    }

    private var header: some View {
        AIFeatureCardHeader(
            content: content,
            canStart: model.canStart,
            connection: model.connection
        )
    }

    private var actionButton: some View {
        AIFeatureCardActionButton(
            content: content,
            isStreaming: model.isStreaming,
            disabled: model.buttonDisabled
        ) {
            model.action()
        }
    }
}

// MARK: - Convenience initializers (slot / children specialisations)

public extension AIFeatureCard where InputSlot == EmptyView, Extra == EmptyView {
    /// The common case: a card with no prompt-input slot and no domain children.
    init(
        model: AIFeatureCardModel,
        content: AIFeatureCardContent,
        placement: AIFeatureCardButtonPlacement = .inline
    ) {
        self.init(model: model, content: content, placement: placement) {
            EmptyView()
        } children: {
            EmptyView()
        }
    }

    /// Mounts the card directly over a live lifecycle snapshot + an action handler (web
    /// `stream.start()` / `onAction`), building the production source-backed model — the parity of
    /// rendering `<AIFeatureCard … stream={stream} />` at a feature call site.
    init(
        content: AIFeatureCardContent,
        input: AIFeatureCardInput,
        placement: AIFeatureCardButtonPlacement = .inline,
        onAct: @escaping @MainActor () -> Void
    ) {
        let source = LiveAIFeatureCardSource(input: input, onAct: onAct)
        self.init(model: AIFeatureCardModel(source: source), content: content, placement: placement)
    }
}

public extension AIFeatureCard where InputSlot == EmptyView {
    /// A card with domain children (rendered between the action and the output panel) but no prompt
    /// input slot — e.g. a feature that surfaces typed envelopes above the streamed text.
    init(
        model: AIFeatureCardModel,
        content: AIFeatureCardContent,
        placement: AIFeatureCardButtonPlacement = .inline,
        @ViewBuilder children: () -> Extra
    ) {
        self.init(model: model, content: content, placement: placement) {
            EmptyView()
        } children: {
            children()
        }
    }
}
