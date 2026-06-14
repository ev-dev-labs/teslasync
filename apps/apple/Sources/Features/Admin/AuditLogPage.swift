import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/AuditLogPage.tsx`
/// (route `/admin/audit-log`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle), the subsystem-unavailable banner (web `subsystemMissing` →
/// `AlertBanner`), and the three web `GlassPanel`s: the hash-chain integrity panel
/// (web "Verify chain" action + result badge — `GlassPanel1`), the filter row
/// (`GlassPanel2`, in `AuditLogPage.Filters.swift`), and the entries panel with the
/// paginated, expandable table (`GlassPanel3`, in `AuditLogPage.Table.swift`).
///
/// Faithful to the web, the integrity + filter panels stay interactive regardless of
/// the list query — the web `PageContainer` only consumes `query` for its freshness
/// badge, so the body always renders and the list state switches *inside* the entries
/// panel (loading / empty / error / success, plus the 503 unavailable variant). All
/// copy resolves from `Localizable.xcstrings` with the web key names; data binds through
/// the `@Observable` `AuditLogPageModel` (no networking in the view, ADR-004). Adaptive
/// across macOS/iPad (regular) + iPhone (compact) per ADR-002/006.
public struct AuditLogPage: View {
    @State private var model: AuditLogPageModel

    public init(model: AuditLogPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if model.isSubsystemUnavailable {
                    subsystemBanner
                }
                integrityPanel
                AuditLogFiltersPanel(model: model)
                entriesPanel
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.auditLog.pageTitle")
            Text("admin.auditLog.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Subsystem-unavailable banner (web `subsystemMissing` AlertBanner)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.auditLog.notConfigured"
        )
    }

    // MARK: - GlassPanel1 — Hash-chain integrity (web "Verify chain" + result)

    private var integrityPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .firstTextBaseline) {
                    TSPanelTitle("admin.auditLog.integrityTitle")
                    Spacer(minLength: TSSpacing.md)
                    verifyButton
                }
                verifyContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.auditLog.integrityTitle"))
    }

    private var isVerifying: Bool {
        model.verifyState == .verifying
    }

    private var verifyButton: some View {
        TSButton(
            isVerifying ? "admin.auditLog.verifying" : "admin.auditLog.verifyButton",
            variant: .secondary,
            size: .small
        ) {
            Task { await model.verify() }
        }
        .disabled(isVerifying)
    }

    @ViewBuilder
    private var verifyContent: some View {
        switch model.verifyState {
        case .idle:
            // Web `!verifyData && !isFetching` → read-only re-derivation hint.
            TSCaption("admin.auditLog.verifyHint")
        case .verifying:
            EmptyView()
        case let .verified(result):
            verifyResult(result)
        case let .failed(message):
            verifyError(message)
        }
    }

    /// Web verify success: an intact/broken badge + rows-checked + first-bad-row captions.
    private func verifyResult(_ result: AuditChainVerify) -> some View {
        HStack(spacing: TSSpacing.md) {
            verifyBadge(intact: result.intact)
            Text(verbatim: Self.rowsCheckedText(result.rowsChecked))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !result.intact, result.firstBadID > 0 {
                Text(verbatim: Self.firstBadIDText(result.firstBadID))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web verify result `Badge` (intact → success shield-check / broken → danger shield-alert).
    private func verifyBadge(intact: Bool) -> some View {
        let tone: TSTone = intact ? .success : .danger
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: intact ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
            Text(intact ? "admin.auditLog.chainIntact" : "admin.auditLog.chainBroken")
        }
        .font(Font.TS.bodySm)
        .fontWeight(.medium)
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(intact ? "admin.auditLog.chainIntact" : "admin.auditLog.chainBroken"))
    }

    /// Web verify failure (`verifyQuery.error` → danger AlertBanner + message).
    private func verifyError(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSAlertBanner(
                tone: .danger,
                systemImage: "xmark.octagon.fill",
                title: "admin.auditLog.verifyErrorTitle"
            )
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
        }
    }

    // MARK: - GlassPanel3 — Entries (web table panel: pagination + DataTable / EmptyState)

    private var entriesPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(alignment: .firstTextBaseline) {
                    TSPanelTitle("admin.auditLog.tableTitle")
                    Spacer(minLength: TSSpacing.md)
                    paginationControls
                }
                entriesBody
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.auditLog.tableTitle"))
    }

    private var paginationControls: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton("admin.auditLog.prevPage", variant: .ghost, size: .small) {
                Task { await model.prevPage() }
            }
            .disabled(!model.canGoPrev)

            Text(verbatim: Self.pageInfoText(from: model.pageFrom, to: model.pageTo))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()

            TSButton("admin.auditLog.nextPage", variant: .ghost, size: .small) {
                Task { await model.nextPage() }
            }
            .disabled(!model.canGoNext)
        }
    }

    @ViewBuilder
    private var entriesBody: some View {
        switch model.state {
        case .loading:
            TSTableSkeleton(rows: 6)
                .accessibilityLabel(Text("admin.auditLog.tableTitle"))
        case .empty:
            // no-action: the filter row above narrows scope; the message guides the user
            // to widen or clear it (web EmptyState has no action button).
            TSEmptyState(
                title: "admin.auditLog.emptyTitle",
                message: "admin.auditLog.emptyMessage",
                systemImage: "clock.arrow.circlepath"
            )
            .frame(maxWidth: .infinity)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.reloadLog() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        case .unavailable:
            // Web `subsystemMissing` still renders the DataTable, whose empty body shows
            // the "No entries" message.
            emptyTableNote
        case let .loaded(rows):
            AuditLogEntriesTable(rows: rows, model: model)
        }
    }

    /// Web `DataTable` empty message (shown in the 503 unavailable branch).
    private var emptyTableNote: some View {
        Text("admin.auditLog.emptyTable")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Interpolated strings (web i18next `{{token}}` → catalog `%lld` / positional)

    /// Resolves `admin.auditLog.rowsChecked` ("%lld rows checked") with the count.
    static func rowsCheckedText(_ count: Int64) -> String {
        String(format: String(localized: "admin.auditLog.rowsChecked"), count)
    }

    /// Resolves `admin.auditLog.firstBadId` ("First bad row: #%lld") with the id.
    static func firstBadIDText(_ id: Int64) -> String {
        String(format: String(localized: "admin.auditLog.firstBadId"), id)
    }

    /// Resolves `admin.auditLog.pageInfo` ("Showing %1$lld–%2$lld") with the range.
    static func pageInfoText(from: Int, to: Int) -> String {
        String(format: String(localized: "admin.auditLog.pageInfo"), from, to)
    }
}

#if DEBUG
    #Preview("Loaded") {
        AuditLogPage(model: AuditLogPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        AuditLogPage(model: AuditLogPageModel(dataSource: PreviewEmptyAuditLog()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        AuditLogPage(model: AuditLogPageModel(dataSource: PreviewUnavailableAuditLog()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        AuditLogPage(model: AuditLogPageModel(dataSource: PreviewFailingAuditLog()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero rows (drives the empty state).
    private struct PreviewEmptyAuditLog: AuditLogDataSource {
        func loadLog(_: AuditLogQuery) async throws -> [AuditLogRow] {
            []
        }

        func loadCategories() async throws -> [String] {
            []
        }

        func loadActions() async throws -> [String] {
            []
        }

        func verifyChain(limit: Int) async throws -> AuditChainVerify {
            AuditChainVerify(intact: true, firstBadID: 0, rowsChecked: 0, since: "", limit: limit)
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableAuditLog: AuditLogDataSource {
        func loadLog(_: AuditLogQuery) async throws -> [AuditLogRow] {
            throw AuditLogSubsystemUnavailable()
        }

        func loadCategories() async throws -> [String] {
            []
        }

        func loadActions() async throws -> [String] {
            []
        }

        func verifyChain(limit: Int) async throws -> AuditChainVerify {
            AuditChainVerify(intact: true, firstBadID: 0, rowsChecked: 0, since: "", limit: limit)
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingAuditLog: AuditLogDataSource {
        struct Failure: Error {}
        func loadLog(_: AuditLogQuery) async throws -> [AuditLogRow] {
            throw Failure()
        }

        func loadCategories() async throws -> [String] {
            []
        }

        func loadActions() async throws -> [String] {
            []
        }

        func verifyChain(limit _: Int) async throws -> AuditChainVerify {
            throw Failure()
        }
    }
#endif
