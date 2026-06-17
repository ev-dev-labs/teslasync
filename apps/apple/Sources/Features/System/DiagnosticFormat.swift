import Foundation

/// Utility to serialize a diagnostic report to plain text for clipboard/download support tickets
/// (web `formatDiagnosticReportText` in useSystemDiagnostic.ts).
public func formatDiagnosticReportText(_ report: DiagnosticReport) -> String {
    var lines: [String] = []
    lines.append("TeslaSync diagnostic report")
    lines.append("Generated: \(report.generatedAt)")
    lines.append("Overall:   \(report.overallStatus.rawValue)")
    lines.append("")
    lines.append("Checks:")
    for check in report.checks {
        lines.append("  [\(check.status.rawValue.uppercased())] \(check.name) (\(check.id)) — \(check.durationMs)ms")
        if !check.detail.isEmpty {
            lines.append("    detail:      \(check.detail)")
        }
        if let remediation = check.remediation, !remediation.isEmpty {
            lines.append("    remediation: \(remediation)")
        }
    }
    lines.append("")
    return lines.joined(separator: "\n")
}
