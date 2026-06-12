//
//  PageContainer.swift
//  TeslaSync — P4 shared surface · 0171 · PageContainer (Apple)
//
//  The PageContainer shared surface — the SwiftUI parity of `components/layout/PageContainer.tsx`. It
//  frames every page: a title / subtitle header with a trailing toolbar (a data-freshness chip derived
//  from the page's `useQuery` result, an optional copy-link button, and the caller's actions), it
//  pushes per-page breadcrumb label overrides up to the global trail (web `useSetBreadcrumbOverrides`)
//  via the shared `BreadcrumbOverridesStore`, and it runs the web four-way body state machine
//  (loading → error → empty → children). Bound through `PageContainerModel` (P1/S8); no networking
//  lives in the view.
//
//  States (every one renders — no hidden surface):
//    • loading — initial fetch (web `loading`) → the centred spinner.
//    • error   — the page's fetch failed (web `error`) → a `QueryError`-equivalent tile carrying the
//                runtime `error.message`, with the P4 leaf retry affordance.
//    • empty   — data resolved, nothing to show (web `empty`) → a friendly empty state carrying the
//                `emptyMessage` (or the resolved `No {title} found.` default), never a blank box.
//    • content — healthy (web default) → the children, wrapped in the page error boundary.
//    • stale / offline — the freshness chip's degraded bands (web `DataFreshnessAuto`) → an amber
//                "stale" chip that auto-refreshes once on the transition, or a Wi-Fi-slash "offline"
//                chip that keeps the last-known render.
//

import Combine
import SwiftUI

// MARK: - PageContainer (the shared surface)

/// The PageContainer shared surface — frames a page with the title / subtitle header, the trailing
/// freshness / copy-link / actions toolbar, the breadcrumb-override bridge, and the body state
/// machine. Generic over the caller's `Actions` slot (web `actions` prop) and the page `Content` (web
/// `children`). Renders every state plus the P4 leaf freshness bands, binding through
/// `PageContainerModel` and re-deriving the relative-age label on a 30s tick (web `DataFreshness`
/// `setInterval`).
public struct PageContainer<Actions: View, Content: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Mirrors the model constant so a generic
    /// `PageContainer.surfaceSlug` reference resolves without spelling the generics.
    public static var surfaceSlug: String {
        PageContainerModel.surfaceSlug
    }

    @State private var model: PageContainerModel
    private let breadcrumbLabels: BreadcrumbOverrideMap?
    private let refetchable: Bool
    private let hasActions: Bool
    private let actions: Actions
    private let content: Content

    /// The web `DataFreshness` re-renders every 30s (a `setInterval`) so the relative-age label stays
    /// current. The native parity ticks the model off a main-run-loop timer; `.onReceive`'s action is a
    /// main-actor, non-`@Sendable` closure, so it can call the `@MainActor` model directly. The
    /// publisher only fires while the view is subscribed.
    private let ticker = Timer
        .publish(every: 30, on: .main, in: .common)
        .autoconnect()

    // MARK: Model-driven initializers (host owns the state-holder)

    /// Binds an externally-owned model plus a custom `actions` slot — used by call sites that already
    /// hold a `PageContainerModel` (and by previews / tests).
    public init(
        model: PageContainerModel,
        refetchable: Bool = true,
        breadcrumbLabels: BreadcrumbOverrideMap? = nil,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        _model = State(initialValue: model)
        self.refetchable = refetchable
        self.breadcrumbLabels = breadcrumbLabels
        hasActions = true
        self.actions = actions()
        self.content = content()
    }

    /// Binds an externally-owned model with no `actions` slot (the common case).
    public init(
        model: PageContainerModel,
        refetchable: Bool = true,
        breadcrumbLabels: BreadcrumbOverrideMap? = nil,
        @ViewBuilder content: () -> Content
    ) where Actions == EmptyView {
        _model = State(initialValue: model)
        self.refetchable = refetchable
        self.breadcrumbLabels = breadcrumbLabels
        hasActions = false
        actions = EmptyView()
        self.content = content()
    }

    // MARK: Controlled-host initializers (the parity of mounting `<PageContainer …>`)

    /// The controlled init with a custom `actions` slot — the parity of `<PageContainer title=…
    /// query=… copyLink actions={…}>…</PageContainer>`. Pass a single resolved `query` (use
    /// ``PageContainerQueryResolver/resolve(_:)`` to collapse a page's `useQuery` fan-out to its
    /// worst-of, the web array support). `breadcrumbLabels` is registered with the shared
    /// `BreadcrumbOverridesStore` while the page is on screen (web `useSetBreadcrumbOverrides`).
    public init(
        title: String,
        subtitle: String? = nil,
        loading: Bool = false,
        errorMessage: String? = nil,
        empty: Bool = false,
        emptyMessage: String? = nil,
        copyLink: Bool = false,
        shareLink: String? = nil,
        query: PageContainerQuery? = nil,
        breadcrumbLabels: BreadcrumbOverrideMap? = nil,
        refetchable: Bool = true,
        @ViewBuilder actions: () -> Actions,
        @ViewBuilder content: () -> Content
    ) {
        let input = PageContainerInput(
            title: title,
            subtitle: subtitle,
            isLoading: loading,
            errorMessage: errorMessage,
            isEmpty: empty,
            emptyMessage: emptyMessage,
            copyLink: copyLink,
            shareLink: shareLink,
            query: query
        )
        _model = State(initialValue: PageContainerModel(source: StaticPageContainerSource(input)))
        self.refetchable = refetchable
        self.breadcrumbLabels = breadcrumbLabels
        hasActions = true
        self.actions = actions()
        self.content = content()
    }

    /// The controlled init with no `actions` slot — the parity of `<PageContainer title=…
    /// query=…>…</PageContainer>` (the common case).
    public init(
        title: String,
        subtitle: String? = nil,
        loading: Bool = false,
        errorMessage: String? = nil,
        empty: Bool = false,
        emptyMessage: String? = nil,
        copyLink: Bool = false,
        shareLink: String? = nil,
        query: PageContainerQuery? = nil,
        breadcrumbLabels: BreadcrumbOverrideMap? = nil,
        refetchable: Bool = true,
        @ViewBuilder content: () -> Content
    ) where Actions == EmptyView {
        let input = PageContainerInput(
            title: title,
            subtitle: subtitle,
            isLoading: loading,
            errorMessage: errorMessage,
            isEmpty: empty,
            emptyMessage: emptyMessage,
            copyLink: copyLink,
            shareLink: shareLink,
            query: query
        )
        _model = State(initialValue: PageContainerModel(source: StaticPageContainerSource(input)))
        self.refetchable = refetchable
        self.breadcrumbLabels = breadcrumbLabels
        hasActions = false
        actions = EmptyView()
        self.content = content()
    }

    // MARK: Body

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            header
            bodyContent
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .setBreadcrumbOverrides(breadcrumbLabels)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onReceive(ticker) { _ in model.tick() }
        .accessibilityElement(children: .contain)
    }

    // MARK: Header (web title row + trailing toolbar)

    /// Whether the trailing toolbar shows — web `(actions || copyLink || resolvedQuery)`.
    private var showsTrailingCluster: Bool {
        hasActions || model.header.showCopyLink || model.freshness != nil
    }

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            PageContainerTitleBlock(title: model.header.title, subtitle: model.header.subtitle)
            if showsTrailingCluster {
                trailingCluster
            }
        }
    }

    /// The trailing toolbar — the freshness chip, the copy-link button, then the caller's actions, in
    /// the web order (`{resolvedQuery && <DataFreshnessAuto>}{copyLink && <CopyLinkButton>}{actions}`).
    private var trailingCluster: some View {
        HStack(spacing: TSSpacing.sm) {
            if let freshness = model.freshness {
                PageContainerFreshnessChip(
                    readout: freshness,
                    refetchable: refetchable,
                    onRefresh: { model.refresh() }
                )
            }
            if model.header.showCopyLink {
                PageContainerCopyLinkButton(onCopy: { model.copyLink() })
            }
            actions
        }
        .layoutPriority(0)
    }

    // MARK: Body state machine (web `loading → error → empty → children`)

    @ViewBuilder
    private var bodyContent: some View {
        switch model.phase {
        case .loading:
            PageContainerLoadingView()
        case let .error(message):
            PageContainerErrorView(message: message) { model.refresh() }
        case let .empty(message):
            PageContainerEmptyView(message: message)
        case .content:
            // The web wraps children in `<PageErrorBoundary pageName={title}>`. SwiftUI has no
            // render-time catch, so the boundary is a passthrough peer here (its catch signal would be
            // host-supplied), preserving the structural parity + the retry path.
            TSPageErrorBoundary(hasError: false, onRetry: { model.refresh() }, content: { content })
        }
    }
}
