import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/SchemaDriftPage.tsx`
/// (route `/admin/schema-drift`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error), the subsystem-unavailable banner
/// (web `subsystemMissing` → `AlertBanner`), the drift-summary panel (web `DriftSummary`
/// → `GlassPanel` with the status badge + three count-delta stat cards), the
/// fingerprints panel (web `DriftDetails` → `GlassPanel` with the current + expected
/// fingerprint cards), and the no-fingerprint empty panel (web `GlassPanel` + `EmptyState`).
/// The two populated panels + their sub-views live in `SchemaDriftPage.Views.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width lays the stat/fingerprint cards in
/// multi-column grids; compact iPhone stacks them. Every data state the source produces
/// is implemented (loading / empty / error / success, plus the 503 unavailable variant).
/// All copy resolves from `Localizable.xcstrings` with the web key names; data binds
/// through the `@Observable` `SchemaDriftPageModel` (no networking in the view).
public struct SchemaDriftPage: View {
    @State private var model: SchemaDriftPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: SchemaDriftPageModel) {
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
            TSPageTitle("admin.schemaDrift.pageTitle")
            Text("admin.schemaDrift.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - State router (web PageContainer loading/error + subsystemMissing + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingState
        case let .error(message):
            errorPanel(message)
        case .unavailable:
            subsystemBanner
        case .empty:
            emptyPanel
        case let .loaded(report):
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                SchemaDriftSummaryPanel(report: report)
                SchemaDriftDetailsPanel(report: report)
            }
        }
    }

    // MARK: - Loading (web PageContainer loading — redaction via shared Skeleton)

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 160, height: 20, cornerRadius: TSRadius.sm)
                    LazyVGrid(columns: loadingColumns, spacing: TSSpacing.md) {
                        ForEach(0 ..< 3, id: \.self) { _ in
                            TSSkeleton(height: 72, cornerRadius: TSRadius.md)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSSkeleton(width: 140, height: 20, cornerRadius: TSRadius.sm)
                    LazyVGrid(columns: loadingColumns, spacing: TSSpacing.md) {
                        ForEach(0 ..< 2, id: \.self) { _ in
                            TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .accessibilityLabel(Text("admin.schemaDrift.pageTitle"))
    }

    private var loadingColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.md)]
    }

    // MARK: - Error (web generic PageContainer error with retry)

    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: - Subsystem-unavailable banner (web `subsystemMissing` AlertBanner)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.schemaDrift.notConfigured"
        )
    }

    // MARK: - Empty (web `GlassPanel` + `EmptyState` — no fingerprint computed yet)

    private var emptyPanel: some View {
        TSGlassPanel {
            // no-action: the schema fingerprint is seeded by an API restart, which is an
            // ops action not exposed in the UI (web EmptyState has no action button).
            TSEmptyState(
                title: "admin.schemaDrift.emptyTitle",
                message: "admin.schemaDrift.emptyMessage",
                systemImage: "doc.text.magnifyingglass"
            )
            .frame(maxWidth: .infinity)
        }
    }
}

#if DEBUG
    #Preview("Loaded") {
        SchemaDriftPage(model: SchemaDriftPageModel())
            .teslaSyncTheme()
    }

    #Preview("Clean (no drift)") {
        SchemaDriftPage(model: SchemaDriftPageModel(dataSource: PreviewCleanSchemaDrift()))
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        SchemaDriftPage(model: SchemaDriftPageModel(dataSource: PreviewEmptySchemaDrift()))
            .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        SchemaDriftPage(model: SchemaDriftPageModel(dataSource: PreviewUnavailableSchemaDrift()))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        SchemaDriftPage(model: SchemaDriftPageModel(dataSource: PreviewFailingSchemaDrift()))
            .teslaSyncTheme()
    }

    /// Preview seam reporting a clean (no-drift) schema (zero deltas, equal fingerprints).
    private struct PreviewCleanSchemaDrift: SchemaDriftDataSource {
        func load() async throws -> SchemaDriftReport? {
            let fp = SchemaFingerprint(
                sha256: "0000aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa7777bbbb",
                tableCount: 141,
                columnCount: 1891,
                indexCount: 327
            )
            return SchemaDriftReport(
                drift: SchemaDrift(
                    hasDrift: false,
                    current: fp,
                    expected: fp,
                    tableCountDelta: 0,
                    columnCountDelta: 0,
                    indexCountDelta: 0,
                    expectedGeneratedAt: "2026-05-28T09:14:22Z"
                ),
                isDifferent: false
            )
        }
    }

    /// Preview seam yielding no fingerprint (drives the empty state).
    private struct PreviewEmptySchemaDrift: SchemaDriftDataSource {
        func load() async throws -> SchemaDriftReport? {
            nil
        }
    }

    /// Preview seam that reports the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableSchemaDrift: SchemaDriftDataSource {
        func load() async throws -> SchemaDriftReport? {
            throw SchemaDriftSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingSchemaDrift: SchemaDriftDataSource {
        struct Failure: Error {}
        func load() async throws -> SchemaDriftReport? {
            throw Failure()
        }
    }
#endif
