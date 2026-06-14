import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/GDPRExportPage.tsx`
/// (route `/admin/gdpr-exports`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle), the subsystem-unavailable banner (web `subsystemMissing` 503),
/// the lookup panel (web `GlassPanel1` — id input + "Look up"), the pre-lookup empty
/// panel (web `GlassPanel2`), the not-found banner (404), and, once an artifact loads,
/// the summary grid (status `GlassPanel3` + Format / Size / Storage stat cards), the
/// details panel (`GlassPanel7`), the failure banner (web `artifact.error`), and the
/// download panel (`GlassPanel8`). The artifact sub-sections live in
/// `GDPRExportPage.Sections.swift`.
///
/// Adaptive (ADR-002/006): macOS/iPad regular width lays the lookup field beside its
/// button and details in two columns; compact iPhone stacks them. Every data state the
/// source produces is implemented (idle / loading / success / not-found / unavailable /
/// error). All copy resolves from `Localizable.xcstrings` with the web key names; data
/// binds through the `@Observable` `GDPRExportPageModel` (no networking in the view).
public struct GDPRExportPage: View {
    @State private var model: GDPRExportPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: GDPRExportPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                header
                if model.isSubsystemUnavailable {
                    subsystemBanner
                }
                lookupPanel
                bodyRegion
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            await model.loadIfNeeded()
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
            TSPageTitle("admin.gdprExport.pageTitle")
            Text("admin.gdprExport.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Subsystem-unavailable banner (web `subsystemMissing` AlertBanner, 503)

    private var subsystemBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.subsystem.unavailableTitle",
            message: "admin.gdprExport.notConfigured"
        )
    }

    // MARK: - Lookup panel (manifest GlassPanel1 — id input + "Look up")

    private var lookupPanel: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("admin.gdprExport.lookupTitle")
                lookupControls
                TSCaption("admin.gdprExport.lookupHint")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("admin.gdprExport.lookupTitle"))
    }

    @ViewBuilder
    private var lookupControls: some View {
        let field = TSTextField(
            "admin.gdprExport.idPlaceholder", // parity:allow i18n key name, not a stub
            text: idBinding,
            label: "admin.gdprExport.idLabel"
        )
        .onSubmit { Task { await model.lookup() } }

        let button = TSButton(variant: .primary, size: .medium) {
            Task { await model.lookup() }
        } label: {
            Label("admin.gdprExport.lookupButton", systemImage: "magnifyingglass")
        }
        .disabled(!model.canLookup)

        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                field
                button
            }
        } else {
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                field
                button
            }
        }
    }

    private var idBinding: Binding<String> {
        Binding(get: { model.idInput }, set: { model.idInput = $0 })
    }

    // MARK: - State region (web `!activeId` empty / notFound / artifact / loading / error)

    @ViewBuilder
    private var bodyRegion: some View {
        switch model.state {
        case .idle:
            noSelectionPanel
        case .loading:
            loadingRegion
        case .notFound:
            notFoundBanner
        case .unavailable:
            // The warning banner renders at the top; the lookup panel stays visible.
            EmptyView()
        case let .error(message):
            errorPanel(message)
        case let .loaded(artifact):
            artifactRegion(artifact)
        }
    }

    // MARK: Pre-lookup empty (manifest GlassPanel2 — "No artifact selected")

    private var noSelectionPanel: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "admin.gdprExport.emptyTitle",
                message: "admin.gdprExport.emptyMessage",
                systemImage: "arrow.down.circle"
            )
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("admin.gdprExport.emptyTitle"))
    }

    // MARK: Not-found banner (web `notFound` AlertBanner, 404)

    private var notFoundBanner: some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "questionmark.circle.fill",
            title: "admin.gdprExport.notFoundTitle",
            message: "admin.gdprExport.notFoundMessage"
        )
    }

    // MARK: Loading (web PageContainer query loading — skeletons)

    private var loadingRegion: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSStatGridSkeleton(count: 4)
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 160, height: 16)
                    ForEach(0 ..< 4, id: \.self) { _ in
                        TSSkeleton(height: 32, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .accessibilityLabel(Text("admin.gdprExport.pageTitle"))
    }

    // MARK: Generic error (web PageContainer error — retryable)

    private func errorPanel(_ message: String) -> some View {
        TSGlassPanel {
            TSErrorDisplay(onRetry: { Task { await model.refresh() } })
                .frame(maxWidth: .infinity)
                .accessibilityValue(Text(verbatim: message))
        }
    }

    // MARK: Loaded artifact (web `SectionErrorBoundary` body)

    private func artifactRegion(_ artifact: GDPRExportArtifact) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            GDPRArtifactSummary(artifact: artifact, isCompact: isCompact)
            GDPRArtifactDetails(artifact: artifact, isCompact: isCompact)
            if let error = artifact.error, !error.isEmpty {
                errorBanner(error)
            }
            GDPRDownloadPanel(
                canDownload: model.canDownload,
                downloadURL: model.downloadURL,
                unavailableKey: model.downloadUnavailableKey
            )
        }
    }

    /// Web `<AlertBanner variant="danger" title={errorTitle}>{artifact.error}</AlertBanner>`.
    /// The dynamic server message renders verbatim through LocalizedStringKey interpolation.
    private func errorBanner(_ message: String) -> some View {
        TSAlertBanner(
            tone: .danger,
            systemImage: "exclamationmark.octagon.fill",
            title: "admin.gdprExport.errorTitle",
            message: "\(message)"
        )
    }
}

#if DEBUG
    #Preview("Loaded") {
        GDPRExportPage(model: GDPRExportPageModel(initialID: SampleGDPRExportDataSource.sampleID))
            .teslaSyncTheme()
    }

    #Preview("Idle") {
        GDPRExportPage(model: GDPRExportPageModel())
            .teslaSyncTheme()
    }

    #Preview("Not found") {
        GDPRExportPage(model: GDPRExportPageModel(
            dataSource: PreviewNotFoundGDPRExport(),
            initialID: SampleGDPRExportDataSource.sampleID
        ))
        .teslaSyncTheme()
    }

    #Preview("Unavailable") {
        GDPRExportPage(model: GDPRExportPageModel(
            dataSource: PreviewUnavailableGDPRExport(),
            initialID: SampleGDPRExportDataSource.sampleID
        ))
        .teslaSyncTheme()
    }

    #Preview("Error") {
        GDPRExportPage(model: GDPRExportPageModel(
            dataSource: PreviewFailingGDPRExport(),
            initialID: SampleGDPRExportDataSource.sampleID
        ))
        .teslaSyncTheme()
    }

    /// Preview seam reporting the artifact missing (drives the 404 not-found banner).
    private struct PreviewNotFoundGDPRExport: GDPRExportDataSource {
        func load(id _: String) async throws -> GDPRExportArtifact {
            throw GDPRArtifactNotFound()
        }
    }

    /// Preview seam reporting the subsystem missing (drives the 503 banner).
    private struct PreviewUnavailableGDPRExport: GDPRExportDataSource {
        func load(id _: String) async throws -> GDPRExportArtifact {
            throw GDPRSubsystemUnavailable()
        }
    }

    /// Preview seam that fails generically (drives the error state).
    private struct PreviewFailingGDPRExport: GDPRExportDataSource {
        struct Failure: Error {}
        func load(id _: String) async throws -> GDPRExportArtifact {
            throw Failure()
        }
    }
#endif
