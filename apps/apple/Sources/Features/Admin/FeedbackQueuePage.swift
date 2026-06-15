import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/FeedbackQueuePage.tsx`
/// (route `/admin/feedback`). Reproduces the web page chrome (web `PageContainer`
/// title) and the single web `GlassPanel` (`GlassPanel1`): the filter row (status +
/// category dropdowns, Refresh, and the bridge-disabled note) sitting above the
/// state-routed body — loading / error / empty / success — with the success branch
/// rendering the paginated, expandable feedback table (web `DataTable` +
/// `renderExpanded`).
///
/// Faithful to the web, the filter row stays interactive across every list state. All
/// copy resolves from `Localizable.xcstrings` with the web key names; data binds
/// through the `@Observable` `FeedbackQueuePageModel` (no networking in the view,
/// ADR-004). Adaptive across macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct FeedbackQueuePage: View {
    @State private var model: FeedbackQueuePageModel

    public init(model: FeedbackQueuePageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                queuePanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { await model.load() }
    }

    // MARK: - Header (web PageContainer title)

    private var header: some View {
        TSPageTitle("feedback.queue.title")
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: - GlassPanel1 — filter row + state-routed body

    private var queuePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                FeedbackQueueFilterRow(model: model)
                if let updateError = model.updateError {
                    TSAlertBanner(
                        tone: .danger,
                        systemImage: "exclamationmark.triangle.fill",
                        title: "toast.feedback.update.error",
                        onDismiss: { model.dismissUpdateError() }
                    )
                    .accessibilityValue(Text(verbatim: updateError))
                }
                queueBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("feedback.queue.title"))
    }

    @ViewBuilder
    private var queueBody: some View {
        switch model.state {
        case .loading:
            TSTableSkeleton(rows: 6)
                .accessibilityLabel(Text("feedback.queue.title"))
        case let .error(message):
            TSQueryError(onRetry: { Task { await model.reload() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case .empty:
            // no-action: feedback arrives by user submission, no admin CTA is possible
            // (web EmptyState has no action button).
            TSEmptyState(
                title: "feedback.queue.empty",
                message: "feedback.queue.emptyMessage",
                systemImage: "ladybug"
            )
            .frame(maxWidth: .infinity)
        case let .loaded(rows):
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                FeedbackQueueTable(rows: rows, model: model)
                paginationRow
            }
        }
    }

    // MARK: - Pagination (web page-info caption + Previous / Next)

    private var paginationRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(verbatim: Self.pageOfText(page: model.page + 1, totalPages: model.totalPages, count: model.total))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
            Spacer(minLength: TSSpacing.md)
            HStack(spacing: TSSpacing.sm) {
                TSButton("common.previous", variant: .ghost, size: .small) {
                    Task { await model.prevPage() }
                }
                .disabled(!model.canGoPrev)
                TSButton("common.next", variant: .ghost, size: .small) {
                    Task { await model.nextPage() }
                }
                .disabled(!model.canGoNext)
            }
        }
    }

    // MARK: - Interpolated string (web i18next `{{token}}` → catalog positional)

    /// Resolves `feedback.queue.pageOf` ("Page %1$lld of %2$lld (%3$lld entries)") with
    /// the 1-based page, total pages, and total entry count (web `pageOf` tokens).
    static func pageOfText(page: Int, totalPages: Int, count: Int) -> String {
        String(format: String(localized: "feedback.queue.pageOf"), page, totalPages, count)
    }
}

/// The filter row at the top of `GlassPanel1` (web filter `<div>` inside the panel):
/// status + category native menus, the Refresh button, and the bridge-disabled note.
/// Split out so the picker bindings get a `@Bindable` model without forcing the page
/// body into one. Adaptive: a row on regular width, stacked on compact iPhone.
struct FeedbackQueueFilterRow: View {
    @Bindable var model: FeedbackQueuePageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    statusFilter
                    categoryFilter
                    refreshButton
                }
            } else {
                HStack(alignment: .bottom, spacing: TSSpacing.md) {
                    statusFilter
                    categoryFilter
                    refreshButton
                    Spacer(minLength: 0)
                }
            }
            if !model.bridgeEnabled {
                Text("feedback.queue.bridgeDisabled")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Status / category dropdowns (web `Select` with the "All …" sentinel)

    private var statusFilter: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("feedback.queue.filter.status")
            Picker(selection: $model.statusFilter) {
                Text("feedback.queue.filter.allStatuses").tag(FeedbackStatus?.none)
                ForEach(FeedbackStatus.allCases) { status in
                    Text(LocalizedStringKey(status.labelKey)).tag(FeedbackStatus?.some(status))
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("feedback.queue.filter.status"))
            .onChange(of: model.statusFilter) { _, _ in
                Task { await model.onFilterChanged() }
            }
        }
    }

    private var categoryFilter: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("feedback.queue.filter.category")
            Picker(selection: $model.categoryFilter) {
                Text("feedback.queue.filter.allCategories").tag(FeedbackCategory?.none)
                ForEach(FeedbackCategory.allCases) { category in
                    Text(LocalizedStringKey(category.labelKey)).tag(FeedbackCategory?.some(category))
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(Text("feedback.queue.filter.category"))
            .onChange(of: model.categoryFilter) { _, _ in
                Task { await model.onFilterChanged() }
            }
        }
    }

    // MARK: - Refresh (web ghost `Button` with spinner-while-fetching)

    private var refreshButton: some View {
        TSButton(variant: .ghost, size: .medium, isLoading: model.isRefreshing) {
            Task { await model.refresh() }
        } label: {
            Label("common.refresh", systemImage: "arrow.clockwise")
        }
        .disabled(model.isRefreshing)
        .accessibilityLabel(Text("common.refresh"))
    }
}

#if DEBUG
    #Preview("Loaded") {
        FeedbackQueuePage(model: FeedbackQueuePageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        FeedbackQueuePage(model: FeedbackQueuePageModel(dataSource: PreviewEmptyFeedback()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        FeedbackQueuePage(model: FeedbackQueuePageModel(dataSource: PreviewFailingFeedback()))
            .teslaSyncTheme()
    }

    #Preview("Bridge disabled") {
        FeedbackQueuePage(
            model: FeedbackQueuePageModel(dataSource: SampleFeedbackQueueDataSource(bridgeEnabled: false))
        )
        .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives the empty state).
    private struct PreviewEmptyFeedback: FeedbackQueueDataSource {
        func loadFeedback(_ query: FeedbackQuery) async throws -> FeedbackListResult {
            FeedbackListResult(items: [], total: 0, limit: query.limit, offset: query.offset, githubBridgeEnabled: true)
        }

        func updateFeedback(id _: Int64, update _: FeedbackUpdate) async throws -> FeedbackEntry {
            throw PreviewFailure()
        }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingFeedback: FeedbackQueueDataSource {
        func loadFeedback(_: FeedbackQuery) async throws -> FeedbackListResult {
            throw PreviewFailure()
        }

        func updateFeedback(id _: Int64, update _: FeedbackUpdate) async throws -> FeedbackEntry {
            throw PreviewFailure()
        }
    }

    private struct PreviewFailure: Error {}
#endif
