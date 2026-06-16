import SwiftUI

/// Native SwiftUI parity of `web/src/features/analytics/pages/YearReviewPage.tsx`
/// (route `/year-review/:year`). A full-bleed, swipe-style annual "Year in Review" story: a deck of
/// twelve slides (web `SLIDE_DEFS`) over festive gradient backdrops, with a segmented progress bar,
/// an optional vehicle selector, tap/drag/keyboard paging, a close affordance, and a slide counter.
///
/// Every data state the source produces is implemented: `loading` (web spinner screen), `empty`
/// (web 🚗 no-data screen), `error` (retryable failure — never a blank region), and `success` (the
/// deck). Adaptive (ADR-002/006): desktop/regular width adds hover-style arrow controls; compact
/// iPhone relies on tap zones + swipe. All copy resolves from `Localizable.xcstrings` with the web
/// key names; data binds through the `@Observable` `YearReviewPageModel` (no networking in the
/// view). SI values convert to the user's unit preference only at the render boundary via `Units`.
public struct YearReviewPage: View {
    @State private var model: YearReviewPageModel
    @Environment(\.tsUnits) private var units
    let onExit: () -> Void

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: YearReviewPageModel, onExit: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onExit = onExit
    }

    public var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(backgroundFill, ignoresSafeAreaEdges: .all)
            .navigationTitle(Text(verbatim: pageTitle))
            .accessibilityLabel(Text(verbatim: pageTitle))
            .task {
                guard model.phase == .loading, model.review == nil else { return }
                await model.load()
            }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    /// Web `usePageTitle(t('yearReview.pageTitle', { year }))` → "{{year}} Year in Review".
    var pageTitle: String {
        String(format: String(localized: "yearReview.pageTitle"), model.year)
    }

    /// The loading / empty / error screens sit on black (web `bg-black`); the deck supplies its own
    /// per-slide gradient.
    private var backgroundFill: some ShapeStyle {
        model.phase == .ready ? AnyShapeStyle(model.currentSlide.backgroundGradient) : AnyShapeStyle(Color.black)
    }

    // MARK: - Phase switch (web `isLoading || !data` → spinner, no-data → empty, else story)

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingView
        case .empty:
            emptyView
        case .error:
            errorView
        case .ready:
            YearReviewStory(model: model, units: units, isCompact: isCompact, onExit: onExit)
        }
    }

    // MARK: - Loading (web centered spinner + "Building your year in review…")

    private var loadingView: some View {
        VStack(spacing: TSSpacing.lg) {
            ProgressView()
                .controlSize(.large)
                .tint(.white)
            Text("yearReview.loading")
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Empty (web 🚗 no-data screen with a Go Back action)

    private var emptyView: some View {
        VStack(spacing: TSSpacing.md) {
            Text(verbatim: "🚗").font(.system(size: 64))
            Text(verbatim: noDataTitle)
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
            Text("yearReview.noDataHint")
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
            TSButton("yearReview.goBack", variant: .secondary, action: onExit)
                .padding(.top, TSSpacing.sm)
        }
        .padding(TSSpacing.x3xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Web `t('yearReview.noData', { year })` → "No driving data for {{year}}".
    private var noDataTitle: String {
        String(format: String(localized: "yearReview.noData"), model.year)
    }

    // MARK: - Error (retryable failure — web keeps the screen non-blank)

    private var errorView: some View {
        VStack(spacing: TSSpacing.md) {
            Text(verbatim: "⚠️").font(.system(size: 56)).accessibilityHidden(true)
            Text("yearReview.errorTitle")
                .font(Font.TS.title)
                .foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center)
            Text("yearReview.errorBody")
                .font(Font.TS.body)
                .foregroundStyle(.white.opacity(0.6))
                .multilineTextAlignment(.center)
            TSButton("action.retry", variant: .secondary) { Task { await model.refresh() } }
                .padding(.top, TSSpacing.sm)
        }
        .padding(TSSpacing.x3xl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#if DEBUG
    #Preview("Story") {
        YearReviewPage(model: YearReviewPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        YearReviewPage(model: YearReviewPageModel(dataSource: EmptyYearReviewDataSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        YearReviewPage(model: YearReviewPageModel(dataSource: FailingYearReviewDataSource()))
            .teslaSyncTheme()
    }
#endif
