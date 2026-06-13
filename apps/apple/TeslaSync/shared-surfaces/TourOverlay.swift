//
//  TourOverlay.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The guided-tour spotlight overlay — the SwiftUI parity of `components/feedback/TourOverlay.tsx`. The
//  web source is a full-screen overlay fed by `useTour`: a dark scrim with a transparent spotlight cut
//  around the highlighted element, an accent border-glow, and a tooltip card (close "×", step counter,
//  title, description, Skip / Back / Next-or-"Get Started!", progress dots), positioned by
//  `getTooltipPosition`; it renders `null` when there is no target rect. The native surface presents the
//  same composition over a full-bleed `GeometryReader` and switches over the model's resolved phase so
//  every prompt-required state renders — loading / empty / error / data, plus the orthogonal stale /
//  offline freshness chip — never a blank box. Binds through `TourOverlayModel` (P1/S8); no tour engine
//  or element geometry lives here.
//

import SwiftUI

/// The tour-overlay surface, binding through `TourOverlayModel` (P1/S8). Present it full-screen above the
/// content it highlights (e.g. as a `ZStack` top layer or a transparent `fullScreenCover`).
public struct TourOverlay: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TourOverlaySurface.slug

    @State private var model: TourOverlayModel

    public init(model: TourOverlayModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer for the controlled usage — seeds a static source from a single snapshot,
    /// the native peer of a host mounting `<TourOverlay step={…} targetRect={…} … />`. `controller`
    /// receives the next / prev / skip intents (web `onNext` / `onPrev` / `onSkip`).
    public init(
        update: TourOverlayUpdate,
        controller: any TourOverlayController = OSLogTourOverlayController()
    ) {
        let source = InMemoryTourOverlaySource(initial: update)
        _model = State(initialValue: TourOverlayModel(source: source, controller: controller))
    }

    public var body: some View {
        GeometryReader { geo in
            let viewport = TourOverlayViewport(width: geo.size.width, height: geo.size.height)
            content(viewport: viewport)
                .frame(width: viewport.width, height: viewport.height)
                .overlay(alignment: .bottom) { freshnessChip }
        }
        .ignoresSafeArea()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The web render between the scrim and the chip: the active spotlight for `.data`, else the
    /// loading / empty / error envelopes over the scrim so no state is hidden behind a blank panel.
    @ViewBuilder
    private func content(viewport: TourOverlayViewport) -> some View {
        switch model.phase {
        case .loading:
            scrimmed { TourOverlayLoadingView() }
        case .empty:
            scrimmed { TourOverlayEmptyView(onSkip: { model.skip() }) }
        case let .error(message):
            scrimmed {
                TourOverlayErrorView(
                    message: message,
                    onRetry: { model.refresh() },
                    onSkip: { model.skip() }
                )
            }
        case .data:
            TourOverlayActiveView(model: model, viewport: viewport)
        }
    }

    /// The freshness chip pinned above the bottom edge when the live tour state is not fresh (P4
    /// connectivity axis), shown across every phase.
    @ViewBuilder
    private var freshnessChip: some View {
        if model.connection != .live {
            TourOverlayFreshnessChip(connection: model.connection) { model.refresh() }
                .padding(.bottom, TSSpacing.x3xl)
        }
    }

    /// Wraps a leaf state in the dimmed, tap-to-skip scrim + a centred fade-in, so the loading / empty /
    /// error chrome reads as the same modal overlay as the data spotlight.
    private func scrimmed(@ViewBuilder _ content: @escaping () -> some View) -> some View {
        ZStack {
            Rectangle()
                .fill(Color.black.opacity(0.55))
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { model.skip() }
                .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.close", "Close tour")))
                .accessibilityAddTraits(.isButton)
            TSFadeIn { content() }
                .padding(TSSpacing.lg)
        }
    }
}
