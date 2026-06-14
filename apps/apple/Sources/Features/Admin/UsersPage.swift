import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/UsersPage.tsx` — the admin "Subjects"
/// impersonation page. Reproduces the web `PageContainer` chrome (title + subtitle) wrapping the
/// single web `GlassPanel` (GlassPanel1), whose body renders one of the five branches the web page
/// switches on:
///  - open-mode note (web `open ? <div>…openMode…</div>`);
///  - loading (web `candidates.isLoading ? <Spinner />`);
///  - error + retry (web `candidates.isError ? <ErrorDisplay onRetry … />`);
///  - empty (web `subjects.length === 0 ? <EmptyState … />`);
///  - the subjects list, each row pairing the opaque subject with the embedded
///    `UserImpersonateButton` (web `<UserImpersonateButton subject disabled={active} />`).
///
/// Adaptive (ADR-002/006): a single leading-aligned column inside a `ScrollView` that fills the
/// regular-width macOS/iPad canvas and the compact iPhone width alike; each subject row stacks its
/// monospaced identifier above its action block so the richer native button never fights the row.
/// Every visible literal resolves from `Localizable.xcstrings` with the web key names verbatim
/// (`impersonation.users.*`); data binds through the `@Observable` `UsersPageModel` — no networking
/// in the view. There are no units on this surface (web `numberFormat`/SI converters unused).
public struct UsersPage: View {
    @State private var model: UsersPageModel

    public init(model: UsersPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                TSGlassPanel { panelBody }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(Text("translation.impersonation.users.title"))
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task { model.load() }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.impersonation.users.title")
            Text("translation.impersonation.users.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Panel body (web GlassPanel branch)

    @ViewBuilder
    private var panelBody: some View {
        switch model.panelState {
        case .openMode:
            openModeNote
        case .loading:
            loadingState
        case let .error(message):
            errorState(message)
        case .empty:
            emptyState
        case let .loaded(subjects):
            subjectsList(subjects)
        }
    }

    /// Web open-mode branch: a secondary-text note explaining impersonation needs forward-auth.
    private var openModeNote: some View {
        Text("translation.impersonation.users.openMode")
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, TSSpacing.sm)
            .accessibilityIdentifier("users-page-open-mode")
    }

    /// Web candidates `isLoading`: a centered spinner.
    private var loadingState: some View {
        HStack {
            Spacer(minLength: 0)
            TSSpinner(label: "translation.impersonation.users.title")
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityIdentifier("users-page-loading")
    }

    /// Web candidates `isError`: the shared error display with a retry that refetches candidates.
    private func errorState(_ message: String) -> some View {
        TSErrorDisplay(onRetry: { model.retryCandidates() })
            .frame(maxWidth: .infinity)
            .accessibilityValue(Text(verbatim: message))
            .accessibilityIdentifier("users-page-error")
    }

    /// Web `subjects.length === 0`: the big empty state (no remediation — wait for another sign-in).
    private var emptyState: some View {
        TSEmptyState(
            title: "translation.impersonation.users.emptyTitle",
            message: "translation.impersonation.users.emptyMessage",
            systemImage: "person.2.slash"
        )
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("users-page-empty")
    }

    // MARK: - Subjects list (web `<ul className="divide-y">` of rows)

    private func subjectsList(_ subjects: [ImpersonationSubject]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(subjects.enumerated()), id: \.element.id) { index, subject in
                if index > 0 { Divider() }
                subjectRow(subject)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("users-page-list")
    }

    /// One subject row: the monospaced opaque identifier (web `font-mono break-all`) above its
    /// embedded `UserImpersonateButton`, which owns its own gated action + every state.
    private func subjectRow(_ subject: ImpersonationSubject) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: subject.subject)
                .font(.system(.subheadline, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            UserImpersonateButton(model: model.rowModel(for: subject.subject))
        }
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("users-page-row-\(subject.subject)")
    }
}

#if DEBUG
    #Preview("Subjects") {
        UsersPage(model: .sample())
            .teslaSyncTheme()
    }

    #Preview("Loading") {
        UsersPage(
            model: UsersPageModel(
                statusProvider: InMemoryImpersonationStatusProvider(
                    initial: .loaded(ImpersonationStatus(mode: .restricted))
                ),
                candidatesProvider: InMemoryUsersCandidatesProvider(initial: .loading)
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Empty") {
        UsersPage(model: .sample(candidates: .loaded([])))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        UsersPage(
            model: UsersPageModel(
                statusProvider: InMemoryImpersonationStatusProvider(
                    initial: .loaded(ImpersonationStatus(mode: .restricted))
                ),
                candidatesProvider: InMemoryUsersCandidatesProvider(initial: .failed(message: "Request timed out"))
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Open mode") {
        UsersPage(
            model: UsersPageModel(
                statusProvider: InMemoryImpersonationStatusProvider(initial: .loaded(ImpersonationStatus(mode: .open))),
                candidatesProvider: InMemoryUsersCandidatesProvider(initial: .loaded([]))
            )
        )
        .teslaSyncTheme()
    }

    #Preview("Active (rows disabled)") {
        UsersPage(
            model: .sample(status: ImpersonationStatus(mode: .restricted, activeSubject: "ak-other-admin"))
        )
        .teslaSyncTheme()
    }
#endif
