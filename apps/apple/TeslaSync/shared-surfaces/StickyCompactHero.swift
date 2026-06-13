//
//  StickyCompactHero.swift
//  TeslaSync — P4 shared surface · 0201 · StickyCompactHero (Apple)
//
//  The SwiftUI surface — the parity of `components/status/StickyCompactHero.tsx`. The web component is an
//  `IntersectionObserver`-driven sticky bar dropped into a page after the full hero: it observes a target
//  element by id and, once that target scrolls above the top of the scroll viewport, pins a compressed
//  status bar at `top: topOffset` (a status icon + short headline, an optional last-checked label, a
//  scroll-to-top up-arrow, and an optional refresh button). It owns no scroll container of its own (it
//  observes the page).
//
//  The idiomatic SwiftUI mapping is a view modifier applied to the page's `ScrollView`, plus a
//  `.stickyCompactHeroTarget()` marker on the hero:
//
//    • .stickyCompactHeroTarget() — the parity of the web `id={targetId}` anchor. It reports the hero's
//      frame in the scroll viewport's coordinate space through a `PreferenceKey`, so the bar binds to its
//      anchor STRUCTURALLY (within the same scroll container) rather than via a global DOM id lookup.
//    • .stickyCompactHero(status:lastCheckedLabel:onRefresh:refreshing:topOffset:…) — the parity of
//      `<StickyCompactHero>`. Applied to the `ScrollView`, it feeds the anchor frame + the viewport height
//      into a ``StickyCompactHeroModel`` and renders the resolved bar through `safeAreaInset(edge: .top)` —
//      the canonical SwiftUI "sticky header" (`position: sticky`), honouring `topOffset` and keeping
//      content reachable. The bar's scroll-to-top button drives `ScrollPosition.scrollTo(edge: .top)` (the
//      native peer of the web smooth scroll-to-top), reduce-motion aware; the refresh button routes out
//      through the page `onRefresh` (ignored while refreshing).
//
//  No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves through
//  P1/S10. The bar chrome lives in StickyCompactHero.Views.swift; the visibility + render decision is the
//  pure ``StickyCompactHeroProjection`` in the Adapter / Projection.
//

import SwiftUI

// MARK: - Surface namespace (P1/S11 slug accessor)

/// The surface's public namespace — exposes the diagnostics slug for hosts + tests, mirroring the web
/// component's stable identity. The renderable chrome is ``StickyCompactHeroBar``; the production
/// integration is the
/// ``SwiftUI/View/stickyCompactHero(status:lastCheckedLabel:onRefresh:refreshing:topOffset:telemetry:)``
/// modifier.
public enum StickyCompactHero {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = StickyCompactHeroSurface.slug
}

// MARK: - Anchor frame plumbing (web `targetId` + IntersectionObserver geometry)

/// The hero anchor's frame in the scroll viewport's coordinate space — the native peer of the
/// `IntersectionObserver` entry's `boundingClientRect` top + bottom (y = 0 is the visible top).
struct StickyCompactHeroTargetFrame: Equatable {
    var top: CGFloat
    var bottom: CGFloat
}

/// Bubbles the hero anchor's viewport-space frame up to the sticky modifier — the parity of the web
/// observer reading `entry.boundingClientRect` for the element with `id={targetId}`.
private struct StickyCompactHeroTargetFrameKey: PreferenceKey {
    static let defaultValue: StickyCompactHeroTargetFrame? = nil
    static func reduce(
        value: inout StickyCompactHeroTargetFrame?,
        nextValue: () -> StickyCompactHeroTargetFrame?
    ) {
        value = nextValue() ?? value
    }
}

// MARK: - StickyCompactHeroModifier (web `<StickyCompactHero>`)

/// The sticky-bar modifier — the parity of `<StickyCompactHero>`. Applied to a `ScrollView`, it tracks the
/// anchor's viewport-space frame (via the ``StickyCompactHeroTargetFrameKey`` preference) and the visible
/// viewport height (via `onScrollGeometryChange`), feeds both to a ``StickyCompactHeroModel`` (which runs
/// the pure visibility decision + the status / last-checked / refresh projection), and renders the
/// resolved bar in a top `safeAreaInset`. The scroll-to-top button drives `ScrollPosition.scrollTo(edge:
/// .top)` and the refresh button routes out through the page `onRefresh` — both reduce-motion aware.
public struct StickyCompactHeroModifier: ViewModifier {
    @State private var model: StickyCompactHeroModel
    @State private var scrollPosition = ScrollPosition(edge: .top)
    @State private var viewportHeight: CGFloat = 0
    @State private var targetFrame: StickyCompactHeroTargetFrame?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let config: StickyCompactHeroConfig
    private let onRefresh: (@MainActor () -> Void)?

    /// Production initializer — builds the model from the config (web props) + the page refresh handler.
    public init(
        config: StickyCompactHeroConfig,
        onRefresh: (@MainActor () -> Void)? = nil,
        telemetry: any StickyCompactHeroTelemetry = OSLogStickyCompactHeroTelemetry()
    ) {
        self.config = config
        self.onRefresh = onRefresh
        _model = State(initialValue: StickyCompactHeroModel(
            config: config,
            onRefresh: onRefresh,
            telemetry: telemetry
        ))
    }

    /// Model-injecting initializer — used by previews + tests that drive a spy telemetry / fixed config.
    public init(model: StickyCompactHeroModel, onRefresh: (@MainActor () -> Void)? = nil) {
        config = model.configuration
        self.onRefresh = onRefresh
        _model = State(initialValue: model)
    }

    public func body(content: Content) -> some View {
        content
            .scrollPosition($scrollPosition)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.containerSize.height
            } action: { _, height in
                viewportHeight = height
            }
            .onPreferenceChange(StickyCompactHeroTargetFrameKey.self) { frame in
                targetFrame = frame
            }
            .onChange(of: viewportHeight) { pushGeometry() }
            .onChange(of: targetFrame) { pushGeometry() }
            .onChange(of: config) { model.update(config, onRefresh: onRefresh) }
            .safeAreaInset(edge: .top, spacing: 0) { stickyBar }
            .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: model.presentation.isVisible)
            .onAppear { model.start() }
    }

    /// The top-pinned bar, rendered only while visible — the parity of `if (!visible) return null`. When
    /// hidden the inset collapses to nothing, so it claims no space until the hero scrolls past.
    @ViewBuilder
    private var stickyBar: some View {
        if model.presentation.isVisible {
            StickyCompactHeroBar(
                presentation: model.presentation,
                onScrollToTop: scrollToTop,
                onRefresh: { model.refresh() }
            )
            .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    /// Combines the latest anchor frame + viewport height into one ``StickyCompactHeroGeometry`` and hands
    /// it to the model — the native peer of one `IntersectionObserver` callback tick. Skips until both the
    /// anchor frame and a real viewport height are known (the bar starts hidden, web `useState(false)`).
    private func pushGeometry() {
        guard let targetFrame, viewportHeight > 0 else { return }
        model.updateGeometry(
            StickyCompactHeroGeometry(
                targetTop: targetFrame.top,
                targetBottom: targetFrame.bottom,
                viewportHeight: viewportHeight
            )
        )
    }

    /// Scrolls the page back to the top — the native peer of the web smooth scroll-to-top. Honours Reduce
    /// Motion (an instant jump when motion is reduced).
    private func scrollToTop() {
        withAnimation(TSAnimation.standard(reduceMotion: reduceMotion)) {
            scrollPosition.scrollTo(edge: .top)
        }
    }
}

// MARK: - Ergonomic entry points (web `<StickyCompactHero>` + `id={targetId}`)

public extension View {
    /// Marks this view as the sticky bar's anchor — the parity of the web `id={targetId}` on the page
    /// hero. The bar appears once this view scrolls above the top of the scroll viewport. Place it on the
    /// page-level full hero inside the same `ScrollView` carrying
    /// ``stickyCompactHero(status:lastCheckedLabel:onRefresh:refreshing:topOffset:telemetry:)``.
    func stickyCompactHeroTarget() -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: StickyCompactHeroTargetFrameKey.self,
                    value: StickyCompactHeroTargetFrame(
                        top: proxy.frame(in: .scrollView(axis: .vertical)).minY,
                        bottom: proxy.frame(in: .scrollView(axis: .vertical)).maxY
                    )
                )
            }
        )
    }

    /// Attaches a sticky compact hero bar to this `ScrollView` — the parity of `<StickyCompactHero>`. The
    /// bar stays hidden until the ``stickyCompactHeroTarget()`` anchor scrolls above the top, then pins a
    /// compressed status bar at `topOffset`: a status icon + short headline, an optional last-checked
    /// label, a scroll-to-top up-arrow, and — when `onRefresh` is supplied — a refresh button.
    func stickyCompactHero(
        status: StickyCompactHeroStatus,
        lastCheckedLabel: String? = nil,
        onRefresh: (@MainActor () -> Void)? = nil,
        refreshing: Bool = false,
        topOffset: CGFloat = 0,
        telemetry: any StickyCompactHeroTelemetry = OSLogStickyCompactHeroTelemetry()
    ) -> some View {
        modifier(
            StickyCompactHeroModifier(
                config: StickyCompactHeroConfig(
                    status: status,
                    lastCheckedLabel: lastCheckedLabel,
                    hasRefresh: onRefresh != nil,
                    refreshing: refreshing,
                    topOffset: topOffset
                ),
                onRefresh: onRefresh,
                telemetry: telemetry
            )
        )
    }

    /// Attaches a sticky compact hero bar from a pre-built model — the previews / tests entry point.
    func stickyCompactHero(
        model: StickyCompactHeroModel,
        onRefresh: (@MainActor () -> Void)? = nil
    ) -> some View {
        modifier(StickyCompactHeroModifier(model: model, onRefresh: onRefresh))
    }
}
