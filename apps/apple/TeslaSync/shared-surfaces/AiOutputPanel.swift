//
//  AiOutputPanel.swift
//  TeslaSync — P4 shared surface · 0036 · AiOutputPanel (Apple)
//
//  The streamed-output renderer — the SwiftUI parity of `components/ai/AiOutputPanel.tsx`. Every
//  AI feature whose primary render contract is a piece of streamed narrative or proposal text
//  composes this panel: a bordered container showing the accumulated `text` as it arrives, an
//  animated thinking indicator while the stream is open and the first delta has not landed, and
//  an inline Helix error row if the stream ended in `error`. The panel renders nothing until a
//  stream has run at least once (web `hasAnything`), then stays visible so the output can be
//  re-read after the stream closes — matching the `useAiStream` lifecycle the host owns.
//
//  Faithful to the web component, this is purely props-driven: it owns no network and no state
//  holder (its only web hook is `useTranslation`, mapped to the P1/S10 facade). The host feeds
//  the accumulated `text`, the lifecycle `state`, and the terminal `error`. Markdown is
//  intentionally not rendered (the LLM strategies emit plain prose); the body preserves paragraph
//  breaks and wraps, the parity of the web `whitespace-pre-wrap`.
//
//  States (every branch renders — the only "hidden" surface is the web-faithful `return null`
//  before anything has streamed):
//    • hidden   — nothing has streamed yet (web `!hasAnything`) → renders nothing.
//    • pending  — stream open, no text yet → the animated thinking indicator (or the injected
//                 pending content; pass `EmptyView` to omit it, the parity of web `null`).
//    • text     — delta frames accumulated → the streamed narrative.
//    • error    — the stream ended in `error` → the Helix error row + resolved message.
//

import SwiftUI

// MARK: - AiOutputPanel (the shared streamed-output surface)

/// The streamed-output panel — the SwiftUI parity of `components/ai/AiOutputPanel.tsx`, generic
/// over the pending (thinking) content. Renders every branch from the web source as a pure
/// function of `text` / `state` / `error`; emits `view.opened` once when first visible (P1/S11).
public struct AiOutputPanel<Pending: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        AiOutputPanelSurface.slug
    }

    private let text: String
    private let state: AiOutputPanelStreamState
    private let error: String?
    private let pending: Pending
    private let telemetry: any AiOutputPanelTelemetry

    @State private var didEmitOpen = false

    /// Designated initializer. `pending` is the content shown in the stream-open / no-text branch;
    /// pass `EmptyView` to omit it (the parity of the web `pendingChild = null`).
    public init(
        text: String,
        state: AiOutputPanelStreamState,
        error: String? = nil,
        telemetry: any AiOutputPanelTelemetry = OSLogAiOutputPanelTelemetry(),
        @ViewBuilder pending: () -> Pending
    ) {
        self.text = text
        self.state = state
        self.error = error
        self.telemetry = telemetry
        self.pending = pending()
    }

    /// The resolved render branch (web `hasAnything` gate + the JSX ternary).
    private var render: AiOutputPanelRender {
        AiOutputPanelLogic.render(text: text, state: state, error: error)
    }

    public var body: some View {
        Group {
            switch render {
            case .hidden:
                EmptyView()
            case let .error(raw):
                panel { AiOutputPanelErrorRow(message: raw) }
            case .pending:
                panel { pending }
            case let .text(value):
                panel { AiOutputPanelTextBody(text: value) }
            }
        }
        .onAppear { emitOpenIfNeeded() }
        .onChange(of: render.isVisible) { _, _ in emitOpenIfNeeded() }
    }

    /// Emits `view.opened` exactly once, the first time the panel becomes visible.
    private func emitOpenIfNeeded() {
        didEmitOpen = AiOutputPanelDiagnostics.openIfVisible(
            render: render,
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// The bordered glass container (web `rounded-lg border border-[--border-subtle] bg-white/2`),
    /// with the resolved branch spoken as one coherent VoiceOver element.
    private func panel(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel(accessibilityLabel)
    }

    /// The spoken label for the live branch, built through the testable `AiOutputPanelLogic` seam.
    private var accessibilityLabel: Text {
        let resolved = AiOutputPanelLogic.accessibilityLabel(for: render, labels: .resolved)
        return Text(verbatim: resolved ?? "")
    }
}

// MARK: - Default pending content (web `pendingChild` undefined → AIThinkingIndicator)

public extension AiOutputPanel where Pending == AiOutputPanelThinkingIndicator {
    /// Convenience initializer matching the web default: when no pending content is supplied the
    /// panel shows the animated [AiOutputPanelThinkingIndicator] while the stream is open and the
    /// first delta has not arrived (web `pendingChild === undefined`).
    init(
        text: String,
        state: AiOutputPanelStreamState,
        error: String? = nil,
        telemetry: any AiOutputPanelTelemetry = OSLogAiOutputPanelTelemetry()
    ) {
        self.init(text: text, state: state, error: error, telemetry: telemetry) {
            AiOutputPanelThinkingIndicator()
        }
    }
}
