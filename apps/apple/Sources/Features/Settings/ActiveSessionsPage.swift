import SwiftUI

/// Native SwiftUI parity of `web/src/features/settings/pages/ActiveSessionsPage.tsx`
/// (route `/account/sessions`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle) and the wrapped `ActiveSessionsSection` body in full — the loading
/// branch, the forward-auth-required ("open mode") advisory, and the forward-auth list
/// of browser/device sessions with per-row + bulk "sign out", each behind a destructive
/// confirmation (web `ConfirmDialog`, no silence key — security prompts always confirm).
///
/// Adaptive (ADR-002/006): macOS/iPad regular width lays the panel header and its bulk
/// action side by side; compact iPhone stacks them. Every data state the source produces
/// is implemented (loading / open / empty / error / loaded). All copy resolves from
/// `Localizable.xcstrings`; data binds through the `@Observable` `ActiveSessionsPageModel`
/// (no networking here, ADR-004). Timestamps format at the display boundary only.
public struct ActiveSessionsPage: View {
    @State private var model: ActiveSessionsPageModel
    @State private var revokeTarget: ActiveSession?
    @State private var showAllOthersConfirm = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Keeps the error panel tall enough to read (web `min-h`).
    private static let errorMinHeight: CGFloat = 220

    public init(model: ActiveSessionsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loading = model.state {
                await model.load()
            }
        }
        .confirmationDialog(
            Text("sessions.confirm.revokeTitle"),
            isPresented: revokeConfirmBinding,
            titleVisibility: .visible,
            presenting: revokeTarget
        ) { session in
            Button(role: .destructive) {
                let target = session
                revokeTarget = nil
                Task { await model.revoke(target) }
            } label: {
                Text("sessions.confirm.revokeConfirm")
            }
            Button(role: .cancel) { revokeTarget = nil } label: {
                Text("sessions.confirm.revokeCancel")
            }
        } message: { session in
            Text(verbatim: revokeMessage(session))
        }
        .confirmationDialog(
            Text("sessions.confirm.allOthersTitle"),
            isPresented: $showAllOthersConfirm,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                showAllOthersConfirm = false
                Task { await model.revokeAllOthers() }
            } label: {
                Text("sessions.confirm.allOthersConfirm")
            }
            Button(role: .cancel) { showAllOthersConfirm = false } label: {
                Text("sessions.confirm.allOthersCancel")
            }
        } message: {
            Text("sessions.confirm.allOthersMessage")
        }
    }

    var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("account.sessions.title")
            Text("account.sessions.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web `useSessions` phases + open-mode branch)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingPanel
        case .open:
            openModePanel
        case let .error(message):
            errorPanel(message)
        case .empty:
            sessionsPanel(rows: [])
        case let .loaded(rows):
            sessionsPanel(rows: rows)
        }
    }

    // MARK: - Loading (web spinner-inside-panel branch)

    private var loadingPanel: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                TSSpinner(label: "sessions.loading")
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Open mode (web AUTH_MODE_OPEN advisory branch)

    private var openModePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.md) {
                    TSIconBox(systemName: "exclamationmark.triangle.fill", tone: .warning)
                    TSPanelTitle("sessions.openMode.title")
                }
                TSHelperText("sessions.openMode.message")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Error (web list-query failure → retryable)

    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(
                title: "sessions.errors.load",
                onRetry: { Task { await model.refresh() } }
            )
            .frame(maxWidth: .infinity, minHeight: Self.errorMinHeight)
            .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Forward-auth list (web GlassPanel: header + actions + DataTable)

    private func sessionsPanel(rows: [ActiveSession]) -> some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                panelHeader
                if let actionError = model.actionError {
                    actionErrorBanner(actionError)
                }
                if rows.isEmpty {
                    TSEmptyState(title: "sessions.empty", systemImage: "laptopcomputer")
                        .frame(maxWidth: .infinity)
                } else {
                    sessionList(rows)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("sessions.a11y.panel"))
    }

    @ViewBuilder
    private var panelHeader: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                headerTitleBlock
                if model.hasOtherSessions {
                    allOthersButton.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                headerTitleBlock
                Spacer(minLength: TSSpacing.sm)
                if model.hasOtherSessions {
                    allOthersButton
                }
            }
        }
    }

    private var headerTitleBlock: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "laptopcomputer", tone: .info)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSPanelTitle("sessions.title")
                TSHelperText("sessions.subtitle")
            }
        }
    }

    private var allOthersButton: some View {
        TSButton(
            variant: .secondary,
            action: { showAllOthersConfirm = true },
            label: { Label(allOthersLabelKey, systemImage: "exclamationmark.shield") }
        )
        .disabled(model.isRevokingAllOthers)
        .accessibilityLabel(Text("sessions.revokeAllOthers"))
    }
}

// MARK: - Session rows + display-boundary helpers

private extension ActiveSessionsPage {
    func sessionList(_ rows: [ActiveSession]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, session in
                if index > 0 {
                    Divider().overlay(Color.TS.border.opacity(0.5))
                }
                sessionRow(session)
                    .padding(.vertical, TSSpacing.sm)
            }
        }
    }

    func sessionRow(_ session: ActiveSession) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: SessionDeviceLabel.text(forUserAgent: session.userAgent))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                if session.current {
                    TSBadge("sessions.current", tone: .success)
                }
                Spacer(minLength: TSSpacing.sm)
                if !session.current {
                    revokeButton(session)
                }
            }
            sessionMeta(session)
        }
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SessionDeviceLabel.text(forUserAgent: session.userAgent)))
    }

    func sessionMeta(_ session: ActiveSession) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            metaItem(label: "sessions.columns.ip", value: ipText(session.ip))
            metaItem(label: "sessions.columns.createdAt", value: Self.formatTimestamp(session.createdAt))
            metaItem(label: "sessions.columns.lastSeenAt", value: Self.formatTimestamp(session.lastSeenAt))
        }
    }

    func metaItem(label: LocalizedStringKey, value: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            TSLabel(label)
            Text(verbatim: value)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    func revokeButton(_ session: ActiveSession) -> some View {
        TSButton(
            variant: .ghost,
            size: .small,
            action: { revokeTarget = session },
            label: { Label("sessions.row.revoke", systemImage: "rectangle.portrait.and.arrow.right") }
        )
        .disabled(model.revokingSessionID == session.id)
        .accessibilityLabel(Text(verbatim: revokeAriaLabel(session)))
    }

    func actionErrorBanner(_ error: ActiveSessionsActionError) -> some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.triangle.fill",
            title: actionErrorKey(error),
            onDismiss: { model.clearActionError() }
        )
    }

    var revokeConfirmBinding: Binding<Bool> {
        Binding(
            get: { revokeTarget != nil },
            set: { presented in if !presented { revokeTarget = nil } }
        )
    }

    var allOthersLabelKey: LocalizedStringKey {
        model.isRevokingAllOthers ? "sessions.revokeAllOthersBusy" : "sessions.revokeAllOthers"
    }

    func actionErrorKey(_ error: ActiveSessionsActionError) -> LocalizedStringKey {
        switch error {
        case .revoke: "sessions.errors.revoke"
        case .revokeAllOthers: "sessions.errors.revokeAllOthers"
        }
    }

    func revokeMessage(_ session: ActiveSession) -> String {
        String(
            format: String(localized: "sessions.confirm.revokeMessage"),
            SessionDeviceLabel.text(forUserAgent: session.userAgent)
        )
    }

    func revokeAriaLabel(_ session: ActiveSession) -> String {
        String(
            format: String(localized: "sessions.row.revokeAria"),
            SessionDeviceLabel.text(forUserAgent: session.userAgent)
        )
    }

    func ipText(_ value: String) -> String {
        value.isEmpty ? "—" : value
    }

    static func formatTimestamp(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .shortened)
    }
}

#if DEBUG
    #Preview("Loaded") {
        ActiveSessionsPage(model: ActiveSessionsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Open mode") {
        ActiveSessionsPage(model: ActiveSessionsPageModel(dataSource: PreviewOpenModeSource()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        ActiveSessionsPage(model: ActiveSessionsPageModel(dataSource: PreviewEmptySessionsSource()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        ActiveSessionsPage(model: ActiveSessionsPageModel(dataSource: PreviewFailingSessionsSource()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding the forward-auth-required branch.
    private struct PreviewOpenModeSource: ActiveSessionsDataSource {
        func load() async throws -> SessionsLoadResult { .open }
        func revoke(id _: String) async throws {}
        func revokeAllOthers() async throws -> Int { 0 }
    }

    /// Preview seam yielding an empty list (drives the empty state).
    private struct PreviewEmptySessionsSource: ActiveSessionsDataSource {
        func load() async throws -> SessionsLoadResult { .sessions([]) }
        func revoke(id _: String) async throws {}
        func revokeAllOthers() async throws -> Int { 0 }
    }

    /// Preview seam that fails (drives the error state).
    private struct PreviewFailingSessionsSource: ActiveSessionsDataSource {
        struct Failure: Error {}
        func load() async throws -> SessionsLoadResult { throw Failure() }
        func revoke(id _: String) async throws {}
        func revokeAllOthers() async throws -> Int { 0 }
    }
#endif
