import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/FleetAPIPage.tsx` (route
/// `/fleet-api`). Reproduces the web page chrome (web `PageContainer`: title + subtitle) and
/// all three top-level web `GlassPanel`s plus their nested glass surfaces:
///
///   • Tesla API Polling (`FleetAPIPollingPanel`) — the suspend/resume switch + the suspended
///     callout (web GlassPanel #1/#2).
///   • API Endpoint Controls (`FleetAPIEndpointsPanel`) — the polling / on-demand / command
///     endpoint toggles, telemetry capture, retention `Select`, and capture-stats note (web
///     GlassPanel #3/#4/#5/#6).
///   • API Endpoints (`FleetAPIConfiguredPanel`) — the configured-URL list (web GlassPanel
///     #7/#8) or its empty state.
///
/// Adaptive (ADR-002/006): the endpoint toggles flow in an adaptive grid (multi-column on
/// macOS/iPad, single column on iPhone). Every data state the source produces is implemented
/// (loading skeleton / empty / success, + a retryable error). All copy resolves from
/// `Localizable.xcstrings` with the web key names; data binds through the `@Observable`
/// `FleetAPIPageModel` (no networking in the view, ADR-004).
public struct FleetAPIPage: View {
    @State private var model: FleetAPIPageModel

    public init(model: FleetAPIPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                noticeBanner
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        // Web `usePageTitle(t('Fleet API'))` — the document/tab title maps to the nav title.
        .navigationTitle(Text("Fleet API"))
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("Fleet API Settings")
            Text("Control Tesla Fleet API polling, endpoint toggles, and telemetry capture")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Mutation notice (web `useToast`)

    @ViewBuilder
    private var noticeBanner: some View {
        if let notice = model.notice {
            FleetAPINoticeBanner(notice: notice) { model.dismissNotice() }
                .transition(.opacity)
        }
    }

    // MARK: - Data states (loading / empty / success, + retryable error)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingBody
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.load() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case .loaded:
            loadedBody
        }
    }

    /// Web `PageContainer loading` — redacted panel skeletons (never a blank region).
    private var loadingBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    TSTableSkeleton(rows: 3)
                }
            }
        }
        .accessibilityLabel(Text("Fleet API Settings"))
    }

    private var loadedBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSFadeIn { FleetAPIPollingPanel(model: model) }
            TSFadeIn { FleetAPIEndpointsPanel(model: model) }
            TSFadeIn { FleetAPIConfiguredPanel(model: model) }
        }
    }
}

/// Maps a `FleetAPINotice` to its web toast title/body + tone, rendered as a dismissible
/// `TSAlertBanner` (web `useToast`). Every literal resolves from the catalog with the web key.
struct FleetAPINoticeBanner: View {
    let notice: FleetAPINotice
    let onDismiss: () -> Void

    var body: some View {
        TSAlertBanner(
            tone: tone,
            systemImage: systemImage,
            title: title,
            message: message,
            onDismiss: onDismiss
        )
    }

    private var tone: TSTone {
        switch notice {
        case .apiSuspended: .info
        case .apiResumed, .pollingUpdated: .success
        case .suspendFailed, .pollingFailed: .danger
        }
    }

    private var systemImage: String {
        switch notice {
        case .apiSuspended: "pause.circle.fill"
        case .apiResumed, .pollingUpdated: "checkmark.circle.fill"
        case .suspendFailed, .pollingFailed: "exclamationmark.triangle.fill"
        }
    }

    private var title: LocalizedStringKey {
        switch notice {
        case .apiSuspended: "API suspended"
        case .apiResumed: "API resumed"
        case .suspendFailed: "Failed"
        case .pollingUpdated: "Polling config updated"
        case .pollingFailed: "Failed to update polling config"
        }
    }

    private var message: LocalizedStringKey? {
        switch notice {
        case .apiSuspended: "All Tesla API calls have been paused"
        case .apiResumed: "Tesla API polling has been re-enabled"
        case .suspendFailed: "Could not toggle API suspension"
        case .pollingUpdated, .pollingFailed: nil
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        FleetAPIPage(model: FleetAPIPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        FleetAPIPage(model: FleetAPIPageModel(dataSource: PreviewEmptyFleetAPI()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        FleetAPIPage(model: FleetAPIPageModel(dataSource: PreviewFailingFleetAPI()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding a snapshot with no polling config / endpoints (drives the empty
    /// states of both the controls and configured-endpoints panels).
    private struct PreviewEmptyFleetAPI: FleetAPIDataSource {
        func load() async throws -> FleetAPISnapshot {
            FleetAPISnapshot(settings: FleetAPISettings(apiSuspended: false))
        }

        func setAPISuspended(_: Bool) async throws {}
        func updatePollingConfig(_: PollingConfig) async throws {}
    }

    /// Preview seam that fails the read (drives the error + Retry state).
    private struct PreviewFailingFleetAPI: FleetAPIDataSource {
        struct Failure: Error {}
        func load() async throws -> FleetAPISnapshot {
            throw Failure()
        }

        func setAPISuspended(_: Bool) async throws {
            throw Failure()
        }

        func updatePollingConfig(_: PollingConfig) async throws {
            throw Failure()
        }
    }
#endif
