//
//  SlideRenderer.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  The composable "Year in Review" slide renderer — the SwiftUI parity of
//  features/analytics/components/review/SlideRenderer.tsx. The web component is a dispatch/wrapper
//  surface: it `AnimatePresence`-wraps a `bg-gradient-to-br ${slide.bg}` `motion.div` keyed by the
//  slide index and `switch`-dispatches on `slide.type` to one of ten child slide components, owning
//  only the two `drive-highlight` labels + emoji + drive selection it forwards.
//
//  This surface reproduces that exactly: it renders the per-slide gradient (P1/S9-free adapter),
//  the keyed enter/exit transition, and dispatches each slide body through a parent-supplied builder
//  — the `DashboardGrid<WidgetBody>` registry pattern — so the real child surfaces (TitleSlide,
//  StatHeroSlide, …, each its own P4 prompt) plug in without this file depending on their concrete
//  types. A built-in `SlideDispatchContent` default renders a complete, data-bound recap so every
//  state composes in isolation. It binds through `SlideRendererModel` (P1/S8) — no networking lives
//  here — exposes the load / empty / error / stale / offline chrome the web parent story shell owns,
//  and on appear emits the P1/S11 `view.opened` diagnostics event.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension SlideRendererStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so the
    /// model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - SlideRenderer (the dispatch surface)

/// The Year-in-Review slide renderer. Generic over the slide body so the parent injects the real child
/// surfaces (web `def.component`); the renderer owns the gradient + keyed transition + dispatch + the
/// P4 states. Binds through `SlideRendererModel` (P1/S8); no networking lives here.
public struct SlideRenderer<SlideBody: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SlideRendererSurface.slug
    }

    @State private var model: SlideRendererModel
    private let slideContent: (SlideRenderContext) -> SlideBody

    /// Designated initialiser. `slide` is the parent's renderer for one slide's body (web
    /// `renderSlideContent()`'s child component); it receives the resolved `SlideRenderContext`.
    public init(
        model: SlideRendererModel,
        @ViewBuilder slide: @escaping (SlideRenderContext) -> SlideBody
    ) {
        _model = State(initialValue: model)
        slideContent = slide
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear {
                model.start()
                model.autoRefreshIfStale()
            }
            .onDisappear { model.stop() }
            .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
            .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states (every state renders)

extension SlideRenderer {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            chromeSurface { SlideRendererLoadingChrome() }
        case .empty:
            chromeSurface { SlideRendererEmptyState() }
        case let .error(message):
            chromeSurface { SlideRendererErrorState(message: message) { model.refresh() } }
        case .content:
            if let context = model.currentContext {
                loadedSlide(context)
            } else {
                chromeSurface { SlideRendererEmptyState() }
            }
        }
    }

    /// The loaded slide: the keyed transition over the gradient + the dispatched body, with the
    /// connectivity banner (when not live) and the freshness/refresh controls overlaid OUTSIDE the
    /// transition so they do not slide with the deck.
    private func loadedSlide(_ context: SlideRenderContext) -> some View {
        ZStack(alignment: .top) {
            SlideTransitionContainer(index: context.index) {
                ZStack {
                    SlideGradientBackground(stops: context.projection.gradient)
                    slideContent(context)
                }
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            }
            if context.connection != .live {
                SlideRendererConnectivityBanner(connection: context.connection)
                    .padding(.top, TSSpacing.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) { headerControls }
    }

    /// Wraps the load/empty/error chrome in a rounded surface card so it is never a bare box (the
    /// gradient is reserved for resolved slides).
    private func chromeSurface(@ViewBuilder _ inner: () -> some View) -> some View {
        inner()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
    }
}

// MARK: - Header controls (freshness + refresh)

extension SlideRenderer {
    private var headerControls: some View {
        HStack(spacing: TSSpacing.xs) {
            SlideRendererFreshnessChip(connection: model.connection, isFetching: model.isFetching)
            refreshButton
        }
        .padding(TSSpacing.sm)
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
                .padding(6)
                .background(Color.black.opacity(0.28), in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(SlideInk.secondary)
        .accessibilityLabel(SlideRendererStrings.text("slideRenderer.refresh", "Refresh"))
    }
}

// MARK: - Default-body convenience (built-in dispatch composition)

public extension SlideRenderer where SlideBody == SlideDispatchContent {
    /// The renderer wired to its built-in, data-bound default body. Used by the previews/tests and as
    /// the app default until the parent injects the richer child surfaces through the generic seam.
    init(model: SlideRendererModel) {
        self.init(model: model) { context in
            SlideDispatchContent(context: context)
        }
    }
}
