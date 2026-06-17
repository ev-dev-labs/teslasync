import SwiftUI

/// Native SwiftUI parity of `web/src/features/system/pages/MyActivityPage.tsx`
/// (route `/me/activity`). Renders the current user's own audit-log entries
/// (`GET /users/me/activity`) so non-admins can answer questions like "what did
/// I change last week?" without needing the admin-wide audit view.
///
/// The endpoint refuses to serve when the deployment isn't running behind a
/// ForwardAuth identity provider (HTTP 503); we surface that as a friendly
/// inline message rather than a generic error page. Implements the three declared
/// data states (loading, empty, success) plus error handling for 503 (feature
/// disabled), 401 (unauthenticated), and general API errors.
///
/// All copy resolves from `Localizable.xcstrings` with the web key names; data
/// binds through the `@Observable` `MyActivityPageModel` (no networking in the
/// view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone (compact) per
/// ADR-002/006.
public struct MyActivityPage: View {
    @State private var model: MyActivityPageModel

    public init(model: MyActivityPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                activityPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { await model.load() }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("activity.myActivity.title")
                .accessibilityAddTraits(.isHeader)
            TSCaption("activity.myActivity.subtitle")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - GlassPanel1 — activity feed with state routing

    private var activityPanel: some View {
        TSGlassPanel {
            activityBody
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("activity.myActivity.title"))
    }

    @ViewBuilder
    private var activityBody: some View {
        switch model.state {
        case .loading:
            TSPageLoader(label: "loading")
                .frame(minHeight: 200)
                .accessibilityLabel(Text("loading"))
        case .featureDisabled:
            TSEmptyState(
                title: "activity.myActivity.disabled.title",
                message: "activity.myActivity.disabled.description",
                systemImage: "lock.shield"
            )
            .frame(maxWidth: .infinity)
        case .unauthorized:
            TSEmptyState(
                title: "activity.myActivity.unauthorized.title",
                message: "activity.myActivity.unauthorized.description",
                systemImage: "person.fill.xmark"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(
                title: "activity.myActivity.error.title",
                message: LocalizedStringKey(message),
                onRetry: { Task { await model.reload() } }
            )
            .frame(maxWidth: .infinity)
        case .empty:
            TSEmptyState(
                title: "activity.myActivity.empty",
                message: "activity.myActivity.emptyMessage",
                systemImage: "clock"
            )
            .frame(maxWidth: .infinity)
        case let .loaded(entries):
            activityFeed(entries: entries)
        }
    }

    // MARK: - Activity feed (TSRecentActivityFeed component)

    private func activityFeed(entries: [ActivityDisplayEntry]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(entries) { entry in
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSIconBox(systemName: entry.systemImage, tone: entry.tone)
                        .frame(width: 32, height: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.title)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textPrimary)
                        if let subtitle = entry.subtitle {
                            Text(subtitle)
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer()
                    TSCaption(LocalizedStringKey(entry.timestamp))
                        .monospacedDigit()
                }
                .padding(.vertical, TSSpacing.xs)
                if entry.id != entries.last?.id {
                    Divider()
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

#if DEBUG
    #Preview("Loaded") {
        MyActivityPage(model: MyActivityPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        MyActivityPage(model: MyActivityPageModel(dataSource: PreviewEmptyActivity()))
            .teslaSyncTheme()
    }

    #Preview("Feature Disabled") {
        MyActivityPage(model: MyActivityPageModel(dataSource: PreviewFeatureDisabledActivity()))
            .teslaSyncTheme()
    }

    #Preview("Unauthorized") {
        MyActivityPage(model: MyActivityPageModel(dataSource: PreviewUnauthorizedActivity()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        MyActivityPage(model: MyActivityPageModel(dataSource: PreviewFailingActivity()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives the empty state).
    private struct PreviewEmptyActivity: MyActivityDataSource {
        func loadMyActivity(_ params: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry] {
            []
        }
    }

    /// Preview seam that returns HTTP 503 (drives the feature-disabled state).
    private struct PreviewFeatureDisabledActivity: MyActivityDataSource {
        func loadMyActivity(_: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry] {
            throw PreviewHTTPError(statusCode: 503)
        }
    }

    /// Preview seam that returns HTTP 401 (drives the unauthorized state).
    private struct PreviewUnauthorizedActivity: MyActivityDataSource {
        func loadMyActivity(_: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry] {
            throw PreviewHTTPError(statusCode: 401)
        }
    }

    /// Preview seam that fails (drives the general error state).
    private struct PreviewFailingActivity: MyActivityDataSource {
        func loadMyActivity(_: Shared.MyActivityParams) async throws -> [Shared.UserActivityEntry] {
            throw PreviewFailure()
        }
    }

    private struct PreviewHTTPError: Error, LocalizedError {
        let statusCode: Int
        var errorDescription: String? { "HTTP \(statusCode)" }
    }

    private struct PreviewFailure: Error, LocalizedError {
        var errorDescription: String? { "Network failure" }
    }
#endif
