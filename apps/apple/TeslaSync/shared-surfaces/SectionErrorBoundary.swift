//
//  SectionErrorBoundary.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The SectionErrorBoundary shared surface — the SwiftUI parity of
//  `components/feedback/SectionErrorBoundary.tsx`. It wraps a section / widget / chart so a render
//  failure inside it surfaces a scoped, recoverable fallback instead of blanking the whole page, and
//  reproduces the three documented fallback modes: the DEFAULT inline alert (with a working Retry),
//  a custom `fallbackTitle` alert (no Retry), and a fully custom `fallback` node (no Retry). Driven
//  by the documented data source — `useTranslation` — bound through `SectionErrorBoundaryModel`
//  (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading — the host is resolving the section's health → skeleton chrome.
//    • empty   — the guarded section has nothing to show → friendly empty card, never a blank box.
//    • content — the section is healthy → the wrapped children render.
//    • caught  — a render failure was caught → the fallback (inline / title / custom).
//    • stale / offline — the orthogonal connectivity axis → a freshness chip with a one-shot
//                auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - SectionErrorBoundary (the shared surface)

/// The SectionErrorBoundary shared surface — wraps `content` and, when its `SectionErrorBoundaryModel`
/// reports a caught render failure, swaps in the configured fallback. Renders every state plus the
/// P4 leaf freshness states. Generic over the guarded `Content` and the optional custom `Fallback`
/// node (web `fallback` prop); for the inline / `fallbackTitle` modes `Fallback` is `EmptyView`.
public struct SectionErrorBoundary<Content: View, Fallback: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Mirrors the non-generic model constant so a
    /// generic `SectionErrorBoundary.surfaceSlug` reference resolves without spelling the generics.
    public static var surfaceSlug: String {
        SectionErrorBoundaryModel.surfaceSlug
    }

    @State private var model: SectionErrorBoundaryModel
    private let content: () -> Content
    private let fallbackContent: () -> Fallback

    // MARK: Model-driven initializers (host owns the state-holder)

    /// Binds an externally-owned model with the default inline / `fallbackTitle` chrome (no custom
    /// fallback node).
    public init(
        model: SectionErrorBoundaryModel,
        @ViewBuilder content: @escaping () -> Content
    ) where Fallback == EmptyView {
        _model = State(initialValue: model)
        self.content = content
        fallbackContent = { EmptyView() }
    }

    /// Binds an externally-owned model (configured with `.custom`) plus the custom fallback node the
    /// surface renders when the boundary catches a failure (web `fallback` prop).
    public init(
        model: SectionErrorBoundaryModel,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder fallback: @escaping () -> Fallback
    ) {
        _model = State(initialValue: model)
        self.content = content
        fallbackContent = fallback
    }

    // MARK: Controlled-host initializers (the parity of mounting `<SectionErrorBoundary …>`)

    /// The DEFAULT mode — the web `<SectionErrorBoundary name=…>` with the underlying `ErrorBoundary`
    /// inline UI (a working Retry). A non-nil `error` shows the fallback; `onRetry` re-attempts the
    /// guarded work, exactly as the web boundary re-renders its children.
    public init(
        name: String,
        error: SectionBoundaryError? = nil,
        hasContent: Bool = true,
        connection: SectionBoundaryConnection = .live,
        isLoading: Bool = false,
        onRetry: (@MainActor () -> Void)? = nil,
        @ViewBuilder content: @escaping () -> Content
    ) where Fallback == EmptyView {
        let source = StaticSectionErrorBoundarySource(
            error: error,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading
        )
        let model = SectionErrorBoundaryModel(name: name, mode: .inline, source: source, onRetry: onRetry)
        _model = State(initialValue: model)
        self.content = content
        fallbackContent = { EmptyView() }
    }

    /// The `fallbackTitle` mode — the web `<SectionErrorBoundary name=… fallbackTitle=…>`: a custom
    /// headline alert with the shared subtitle copy and NO Retry, exactly as the web branch omits it.
    public init(
        name: String,
        fallbackTitle: String,
        error: SectionBoundaryError? = nil,
        hasContent: Bool = true,
        connection: SectionBoundaryConnection = .live,
        isLoading: Bool = false,
        @ViewBuilder content: @escaping () -> Content
    ) where Fallback == EmptyView {
        let source = StaticSectionErrorBoundarySource(
            error: error,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading
        )
        let model = SectionErrorBoundaryModel(name: name, mode: .title(fallbackTitle), source: source)
        _model = State(initialValue: model)
        self.content = content
        fallbackContent = { EmptyView() }
    }

    /// The `fallback` mode — the web `<SectionErrorBoundary name=… fallback={…}>`: the caller supplies
    /// the entire fallback node (rendered on catch) and NO Retry is shown.
    public init(
        name: String,
        error: SectionBoundaryError? = nil,
        hasContent: Bool = true,
        connection: SectionBoundaryConnection = .live,
        isLoading: Bool = false,
        @ViewBuilder content: @escaping () -> Content,
        @ViewBuilder fallback: @escaping () -> Fallback
    ) {
        let source = StaticSectionErrorBoundarySource(
            error: error,
            hasContent: hasContent,
            connection: connection,
            isLoading: isLoading
        )
        let model = SectionErrorBoundaryModel(name: name, mode: .custom, source: source)
        _model = State(initialValue: model)
        self.content = content
        fallbackContent = fallback
    }

    // MARK: Body

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            sectionBody
            if model.connection != .live {
                SectionBoundaryFreshnessChip(connection: model.connection) {
                    model.refresh()
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var sectionBody: some View {
        switch model.phase {
        case .loading:
            SectionBoundaryLoadingView()
        case .empty:
            SectionBoundaryEmptyView()
        case .content:
            content()
        case .caught:
            if let fallback = model.resolved.fallback {
                switch fallback.kind {
                case .inline, .title:
                    SectionBoundaryAlertFallback(content: fallback) { model.retry() }
                case .custom:
                    fallbackContent()
                }
            }
        }
    }
}
