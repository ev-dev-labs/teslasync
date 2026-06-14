import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/RbacMatrixPage.tsx` — the
/// provider-agnostic "who can do what" admin matrix (columns = proxy-group roles, rows =
/// permission catalog, cells = allow/deny). Read-only by default; the Edit toggle flips cells
/// into checkboxes and Save PUTs only the changed cells (sudo-gated upstream, so the reauth
/// dialog pops transparently). Reproduces the web page chrome (`PageContainer` title +
/// subtitle) and all three web `GlassPanel`s:
///
///   GlassPanel1 — the `AUTH_MODE_OPEN` forward-auth notice (`openModePanel`).
///   GlassPanel2 — the summary bar: my-roles + effective pills + Edit/Save (`RbacSummaryPanel`).
///   GlassPanel3 — the role×permission matrix grid (`RbacMatrixGridPanel`).
///
/// One query drives the page, so its four data states (loading / empty / error / success) are
/// switched here in place; never a blank region. All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `RbacMatrixPageModel` (no
/// networking in the view, ADR-004). Adaptive across macOS/iPad (regular) + iPhone (compact)
/// per ADR-002/006.
public struct RbacMatrixPage: View {
    @State private var model: RbacMatrixPageModel

    public init(model: RbacMatrixPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                content
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
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("rbac.title")
            Text("rbac.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Data states (web matrixQuery branches)

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            loadingState
        case .openMode:
            openModePanel
        case let .error(code):
            errorState(code: code)
        case .empty:
            emptyState
        case let .loaded(session):
            loadedContent(session)
        }
    }

    /// Loading (web `Spinner`) → a redacted matrix skeleton (HIG, ADR-013).
    private var loadingState: some View {
        TSGlassPanel {
            TSTableSkeleton(rows: 6)
        }
        .accessibilityLabel(Text("rbac.title"))
    }

    /// GlassPanel1 — `AUTH_MODE_OPEN` notice (web `rbac-open-mode`).
    private var openModePanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(Color.TS.statusInfo)
                        .accessibilityHidden(true)
                    TSSectionTitle("rbac.openMode.title")
                }
                TSHelperText("rbac.openMode.message")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("rbac.openMode.title"))
    }

    /// Error (web `AlertBanner` + Retry). Shows the API code, falling back to the generic copy.
    private func errorState(code: String?) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                TSPanelTitle("rbac.errors.loadTitle")
            }
            Text(verbatim: code ?? String(localized: "rbac.errors.loadGeneric"))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            TSButton("rbac.actions.retry", variant: .secondary, size: .small) {
                Task { await model.load() }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    /// Empty (web `EmptyState`) — no roles forwarded by the proxy and no bindings.
    private var emptyState: some View {
        TSEmptyState(
            title: "rbac.empty.title",
            message: "rbac.empty.message",
            systemImage: "person.2.slash"
        )
        .frame(maxWidth: .infinity)
    }

    // MARK: - Success (web summary GlassPanel + grid GlassPanel)

    private func loadedContent(_ session: RbacMatrixSession) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            RbacSummaryPanel(model: model, session: session)
            if model.submitFailed {
                submitErrorBanner
            }
            RbacMatrixGridPanel(model: model, session: session)
        }
    }

    /// The save-failure banner (web `rbac-save-error`): API code or the generic save copy.
    private var submitErrorBanner: some View {
        Text(verbatim: model.submitErrorCode ?? String(localized: "rbac.errors.saveGeneric"))
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.statusDanger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.statusDanger.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
    }
}

#if DEBUG
    #Preview("Loaded") {
        RbacMatrixPage(model: RbacMatrixPageModel())
            .teslaSyncTheme()
    }

    #Preview("Open mode") {
        RbacMatrixPage(model: RbacMatrixPageModel(dataSource: PreviewOpenModeRbac()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        RbacMatrixPage(model: RbacMatrixPageModel(dataSource: PreviewEmptyRbac()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        RbacMatrixPage(model: RbacMatrixPageModel(dataSource: PreviewFailingRbac()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding the open-mode envelope (drives GlassPanel1).
    private struct PreviewOpenModeRbac: RbacMatrixDataSource {
        func loadMatrix() async throws -> RbacMatrixResult {
            .openMode
        }

        func upsertCells(_: [RbacUpsertCell]) async throws {}
    }

    /// Preview seam yielding zero roles (drives the empty state).
    private struct PreviewEmptyRbac: RbacMatrixDataSource {
        func loadMatrix() async throws -> RbacMatrixResult {
            .session(RbacMatrixSession(
                roles: [], permissions: [], categories: [], matrix: [:], effectiveForMe: [:], myRoles: []
            ))
        }

        func upsertCells(_: [RbacUpsertCell]) async throws {}
    }

    /// Preview seam that fails the matrix read (drives the error state).
    private struct PreviewFailingRbac: RbacMatrixDataSource {
        func loadMatrix() async throws -> RbacMatrixResult {
            throw RbacApiError(code: "INTERNAL")
        }

        func upsertCells(_: [RbacUpsertCell]) async throws {
            throw RbacApiError(code: "INTERNAL")
        }
    }
#endif
