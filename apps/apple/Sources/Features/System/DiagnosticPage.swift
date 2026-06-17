import SwiftUI

/// Native SwiftUI parity of `web/src/features/system/pages/DiagnosticPage.tsx` (unrouted admin page).
/// Operator-facing self-test wizard with a single "Run diagnostic" button that posts to
/// `POST /system/diagnostic` and renders the structured report as check cards plus an overall hero
/// badge. The report can be copied to the clipboard or downloaded as .txt for support escalation.
///
/// Adaptive (ADR-002/006): content column centers on macOS/iPad regular width and fills compact
/// iPhone width. All copy resolves from `Localizable.xcstrings` with the web key names; data binds
/// through the `@Observable` `DiagnosticPageModel` (no networking in the view).
///
/// The page has 5 distinct GlassPanel regions: error banner, overall hero, loading spinner, empty
/// state, and per-check cards. Every data state (idle, running, complete, error) renders a fully
/// populated surface; no region is ever hidden behind a null check (ADR-011).
public struct DiagnosticPage: View {
    @State fileprivate var model: DiagnosticPageModel
    @State fileprivate var showCopyConfirm = false

    #if os(iOS)
        @Environment(\.horizontalSizeClass) fileprivate var horizontalSizeClass
    #endif

    public init(model: DiagnosticPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            content
                .frame(maxWidth: 800)
                .frame(maxWidth: .infinity)
                .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .navigationTitle(Text("diagnostic.title"))
        .toolbar { toolbarActions }
        .alert("diagnostic.copyReportSuccess", isPresented: $showCopyConfirm) {}
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarActions: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            runButton
        }
    }

    private var runButton: some View {
        TSButton(
            model.report == nil ? "diagnostic.run" : "diagnostic.rerun",
            variant: .primary,
            size: .medium,
            isLoading: model.isRunning
        ) {
            Task { await model.run() }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            headerSection
            if let error = model.latestError {
                errorPanel(error)
            }
            if let report = model.report {
                overallHeroPanel(report)
                actionsBar
                checkCardsGrid(report.checks)
            } else if model.isRunning {
                loadingPanel
            } else {
                emptyPanel
            }
        }
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("diagnostic.title")
            TSText("diagnostic.subtitle", variant: .small)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    // MARK: - Helpers (panels and cards are in DiagnosticPage.Sections.swift)

    fileprivate func overallTone(_ status: DiagnosticOverallStatus) -> TSTone {
        switch status {
        case .ok: .success
        case .degraded: .warning
        case .down: .danger
        }
    }

    fileprivate func overallIcon(_ status: DiagnosticOverallStatus) -> String {
        switch status {
        case .ok: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .down: "xmark.shield.fill"
        }
    }

    fileprivate func statusTone(_ status: DiagnosticCheckStatus) -> TSTone {
        switch status {
        case .ok: .success
        case .warn: .warning
        case .fail: .danger
        }
    }

    fileprivate func statusIcon(_ status: DiagnosticCheckStatus) -> String {
        switch status {
        case .ok: "checkmark.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .fail: "xmark.circle.fill"
        }
    }

    fileprivate func formatDateTime(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else { return isoString }
        let display = DateFormatter()
        display.dateStyle = .medium
        display.timeStyle = .short
        return display.string(from: date)
    }

    fileprivate func copyToClipboard(_ text: String) {
        #if os(macOS)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
        #elseif os(iOS)
            UIPasteboard.general.string = text
        #endif
    }

    fileprivate func downloadReport() {
        guard let report = model.report else { return }
        let filename = downloadFilename(report.generatedAt)
        let text = model.reportText

        #if os(macOS)
            let panel = NSSavePanel()
            panel.nameFieldStringValue = filename
            panel.allowedContentTypes = [.plainText]
            panel.begin { response in
                if response == .OK, let url = panel.url {
                    try? text.write(to: url, atomically: true, encoding: .utf8)
                }
            }
        #elseif os(iOS)
            // iOS: Share sheet (web downloads directly; iOS needs share or Files app)
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
            try? text.write(to: tempURL, atomically: true, encoding: .utf8)
            let activityVC = UIActivityViewController(activityItems: [tempURL], applicationActivities: nil)
            if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
               let rootVC = scene.windows.first?.rootViewController {
                rootVC.present(activityVC, animated: true)
            }
        #endif
    }

    private func downloadFilename(_ isoString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: isoString) else {
            let now = Date()
            let stamp = ISO8601DateFormatter().string(from: now).replacingOccurrences(of: ":", with: "-")
            return "teslasync-diagnostic-\(stamp).txt"
        }
        let stamp = ISO8601DateFormatter().string(from: date).replacingOccurrences(of: ":", with: "-")
        return String(
            localized: "diagnostic.filename",
            defaultValue: "teslasync-diagnostic-\(stamp).txt"
        )
    }
}

// MARK: - Previews

private struct CompleteReportDataSource: DiagnosticDataSource {
    func runDiagnostic() async throws -> DiagnosticReport {
        DiagnosticReport(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            overallStatus: .ok,
            checks: [
                DiagnosticCheck(
                    id: "db",
                    name: "Database",
                    status: .ok,
                    detail: "Connection healthy",
                    remediation: nil,
                    durationMs: 42
                ),
                DiagnosticCheck(
                    id: "redis",
                    name: "Redis",
                    status: .warn,
                    detail: "High memory usage",
                    remediation: "Consider scaling up",
                    durationMs: 18
                )
            ]
        )
    }
}

#Preview("Idle") {
    NavigationStack {
        DiagnosticPage(model: DiagnosticPageModel())
    }
}

#Preview("Complete") {
    let model = DiagnosticPageModel(dataSource: CompleteReportDataSource())
    NavigationStack {
        DiagnosticPage(model: model)
            .task { await model.run() }
    }
}
