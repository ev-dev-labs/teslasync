import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/SecretRotationPage.tsx`
/// (route `/admin/secret-rotation`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level error), the subsystem-unavailable banner (web
/// `subsystemMissing` → `AlertBanner`), the overdue-rotations danger banner (web
/// `counts.critical > 0` → `AlertBanner`), the four summary stat cards (web `StatCard`
/// grid, shown only when there are tracked secrets), and the rotation-status panel (web
/// `GlassPanel` + `DataTable` / `EmptyState`). The adaptive table itself lives in
/// `SecretRotationPage.Table.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width renders a columnar table; compact
/// iPhone renders per-secret cards. Every data state the source produces is implemented
/// (loading / empty / error / success, plus the 503 unavailable variant). All copy
/// resolves from `Localizable.xcstrings` with the web key names; data binds through the
/// `@Observable` `SecretRotationPageModel` (no networking in the view).
public struct SecretRotationPage: View {
    @State private var model: SecretRotationPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    /// Number of shimmer rows shown while the report loads (web table `Skeleton`).
    private static let skeletonRowCount = 5

    public init(model: SecretRotationPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                stateContent
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

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.secretRotation.pageTitle")
            Text("admin.secretRotation.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case let .error(message):
            errorPanel(message)
        default:
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                if model.isSubsystemUnavailable {
                    subsystemBanner
                }
                if model.hasCriticalOverdue {
                    criticalBanner
                }
                if model.showsSummary {
                    summaryGrid
                }
                rotationPanel
            }
        }
    }

    /// Web generic PageContainer error (non-503): a panel-level error with retry.
    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Banners (web `subsystemMissing` + `counts.critical > 0` AlertBanners)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.secretRotation.notConfigured"
        )
    }

    private var criticalBanner: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.secretRotation.criticalTitle",
            message: "\(Self.criticalMessageText(model.counts.critical))"
        )
    }

    // MARK: - Summary stat cards (web `StatCard` grid — Tracked / OK / Warn / Critical)

    private var summaryGrid: some View {
        let counts = model.counts
        return LazyVGrid(columns: statColumns, spacing: TSSpacing.md) {
            TSStatCard(
                title: "admin.secretRotation.totalLabel",
                value: SecretRotationFormat.number(counts.total),
                systemImage: "checkmark.shield.fill"
            )
            TSStatCard(
                title: "admin.secretRotation.okLabel",
                value: SecretRotationFormat.number(counts.ok)
            )
            TSStatCard(
                title: "admin.secretRotation.warnLabel",
                value: SecretRotationFormat.number(counts.warn)
            )
            TSStatCard(
                title: "admin.secretRotation.criticalLabel",
                value: SecretRotationFormat.number(counts.critical),
                systemImage: counts.critical > 0 ? "exclamationmark.triangle.fill" : nil
            )
        }
    }

    private var statColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    // MARK: - Rotation-status panel (web `GlassPanel` #5 — PanelTitle + DataTable / EmptyState)

    private var rotationPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("admin.secretRotation.tableTitle")
                rotationContent
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.secretRotation.tableTitle"))
    }

    @ViewBuilder
    private var rotationContent: some View {
        switch model.state {
        case .loading:
            skeletonRows
        case .empty:
            TSEmptyState(
                title: "admin.secretRotation.emptyTitle",
                message: "admin.secretRotation.emptyMessage",
                systemImage: "checkmark.shield"
            )
            .frame(maxWidth: .infinity)
        case .unavailable:
            emptyTableNote
        case let .loaded(rows):
            SecretRotationTable(rows: rows)
        case .error:
            EmptyView()
        }
    }

    private var skeletonRows: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< Self.skeletonRowCount, id: \.self) { _ in
                TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityLabel(Text("admin.secretRotation.tableTitle"))
    }

    /// Web `DataTable` empty message (shown in the 503 unavailable branch).
    private var emptyTableNote: some View {
        Text("admin.secretRotation.emptyTable")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, TSSpacing.lg)
    }

    // MARK: - Interpolated banner string (web i18next `{{count}}` → catalog `%lld`)

    /// Resolves `admin.secretRotation.criticalMessage` ("%lld secrets are past their
    /// critical rotation threshold…") with the overdue count.
    static func criticalMessageText(_ count: Int) -> String {
        String(format: String(localized: "admin.secretRotation.criticalMessage"), count)
    }
}

#if DEBUG
    #Preview("Loaded") {
        SecretRotationPage(model: SecretRotationPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        SecretRotationPage(model: SecretRotationPageModel(dataSource: PreviewEmptySecretRotation()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        SecretRotationPage(model: SecretRotationPageModel(dataSource: PreviewUnavailableSecretRotation()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        SecretRotationPage(model: SecretRotationPageModel(dataSource: PreviewFailingSecretRotation()))
            .teslaSyncTheme()
    }

    /// Preview seam yielding zero tracked secrets (drives the empty state).
    private struct PreviewEmptySecretRotation: SecretRotationDataSource {
        func load() async throws -> [SecretRotationStatus] {
            []
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableSecretRotation: SecretRotationDataSource {
        func load() async throws -> [SecretRotationStatus] {
            throw SecretRotationSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingSecretRotation: SecretRotationDataSource {
        struct Failure: Error {}
        func load() async throws -> [SecretRotationStatus] {
            throw Failure()
        }
    }
#endif
