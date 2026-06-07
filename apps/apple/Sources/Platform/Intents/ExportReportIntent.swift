import AppIntents

/// Opens the export flow for a chosen report. The actual report generation is a
/// backend job owned by the in-app export screen; this intent is a thin,
/// auth-gated entry point that foregrounds the app on the right route.
public struct ExportReportIntent: AppIntent {
    public static let title: LocalizedStringResource = "intent.export.title"
    public static let description = IntentDescription("intent.export.description")
    public static let openAppWhenRun = true

    @Parameter(title: "intent.param.report")
    public var report: ReportKind

    public init() {}

    public init(report: ReportKind) {
        self.report = report
    }

    @MainActor
    public func perform() async throws -> some IntentResult & ProvidesDialog {
        guard IntentBridge.shared.isAuthenticated else {
            throw TeslaSyncIntentError.needsAuthentication
        }
        IntentBridge.shared.requestRoute(report.route)
        return .result(dialog: IntentDialog("intent.export.opening \(String(localized: report.titleResource))"))
    }
}
